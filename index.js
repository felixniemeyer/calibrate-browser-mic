window.addEventListener('load', () => {
	let button = document.getElementById("calibrate-button")
	const c = () => {
	  const results = []
	  const beeps = 3
	  let resultsPending = beeps
    addResult = (freq, coverage, index) => {
      const ul = document.getElementById('results') 
      const li = document.createElement('li')
      li.textContent = `freq: ${freq}, ms coverage=${coverage}, start ms=${index}`
      ul.appendChild(li) 
      results.push({
        freq, 
        coverage, 
        index
      })
      resultsPending -= 1
      if(resultsPending == 0) {
        summarize(results) 
      }
    }
	  calibrate(beeps, addResult)
  }
	button.addEventListener('click', c)
})

function summarize(results) {
  let indexSum = 0
  for(result of results) {
    indexSum += result.index
  }
  let div = document.getElementById("summary")
  div.textContent = `avg start = ${indexSum / results.length}`
}

async function calibrate(beeps, resultCallback) {
	const ac = new AudioContext()
	await ac.resume()

	const stream = await initUserMedia()	
	const mediaRecorder = new MediaRecorder(stream)

  const delay = 0.7
  const beepDuration = 0.1
  const safety = 0.2

	for(let i = 0; i < beeps; i++) {
		const freq = 2500 + i * 200
		
    // record
    const source = ac.createOscillator()
    source.connect(ac.destination)
		const now = ac.currentTime
		source.frequency.setValueAtTime(freq, now)
		source.start(now + delay)
		source.stop(now + delay + beepDuration)
		const audioBlob = await recordInterval(mediaRecorder, delay + beepDuration + safety)
		const audioBuffer = await toAudioBuffer(audioBlob, ac) 
    source.disconnect()

    // measure

    const sampleRate = ac.sampleRate
    const oac = new OfflineAudioContext(1, sampleRate * 2, sampleRate)
    await oac.audioWorklet.addModule('beep-detector.js', {
      credentials: 'omit'
    })
    const beepDetector = new AudioWorkletNode(oac, 'beep-detector')
    const playbackNode = oac.createBufferSource()
    playbackNode.buffer = audioBuffer
    playbackNode.connect(beepDetector)
	  playbackNode.start(0)

    beepDetector.port.onmessage = (f => (
      event => {
        console.log(event.data)
        const result = evaluate(
          event.data, 
          beepDuration, 
          f 
        )
        resultCallback(freq, result.coverage, result.index) 
      })
    )(freq)

	  await oac.startRendering()
	  beepDetector.port.postMessage({a: 1})
	} 
}

async function initUserMedia () {
	if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
		const constraints = {
			audio: {
				echoCancellation: false,
				noiseSuppression: false,
				autoGainControl: false
			},
			video: false // wäre eigentlich geil, das auch zu ermöglichen => V4 ;)
		}
    return await navigator.mediaDevices.getUserMedia(constraints)
  } else {
    throw Error('getUserMedia not supported on your browser!')
  }
}

function recordInterval(mediaRecorder, duration) {
  return new Promise((resolve, reject) => {
    const chunks = []
    mediaRecorder.ondataavailable = event => {
      chunks.push(event.data)
    }
    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, {
        type: 'audio/ogg; codecs=opus'
      })
      resolve(blob)
    }
    mediaRecorder.start()
    setTimeout(() => {mediaRecorder.stop()}, duration * 1000)
  })
}

function toAudioBuffer(blob, ac) {
  return new Promise((resolve, reject) => {
    const fileReader = new FileReader()
    fileReader.onloadend = () => {
      const arrayBuffer = fileReader.result
      if (arrayBuffer instanceof ArrayBuffer) {
        ac.decodeAudioData(arrayBuffer).then(
          (audioBuffer) => {
            resolve(audioBuffer)
          },
          (err) => {
            reject(new Error(`failed to decode audio blob: ${err}`))
          }
        )
      } else {
        reject(new Error('arrayBuffer is not an ArrayBuffer'))
      }
    }
    fileReader.readAsArrayBuffer(blob)
  })
}

function evaluate(freqs, beepDuration, freq) {
  const oks = freqs.map(f => 
    (f < freq + 10 && f > freq - 10) ? 1 : 0
  )

  const length = Math.floor(beepDuration * 1000)
  let bestIndex = 0
  let value = 0
  for(let i = 0; i < length; i++) {
    value += oks[i]
  }
  let bestValue = value
  let index = 1
  while(index + length < freqs.length) {
    value += oks[index + length]
    value -= oks[index - 1]
    if(value > bestValue) {
      bestValue = value
      bestIndex = index
    }
    index += 1
  }
  return {
    index: bestIndex, 
    coverage: bestValue
  }
}


