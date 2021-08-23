window.addEventListener('load', () => {
	let button = document.getElementById("calibrate-button")
	const c = () => {
	  const results = []
	  const beeps = 20
	  let resultsPending = beeps
    addResult = (freq, delta) => {
      const ul = document.getElementById('results') 
      const li = document.createElement('li')
      li.textContent = `freq: ${freq}, delta=${Math.floor(-1000 * delta)}`
      ul.appendChild(li) 
      results.push({
        freq, 
        delta 
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
  let startSum = 0
  for(result of results) {
    startSum += result.delta
  }
  let div = document.getElementById("summary")
  let ms = -1000 * startSum / results.length
  div.textContent = `recommended offset = ${ms}`
}

async function calibrate(beeps, resultCallback) {
	const ac = new AudioContext()
	await ac.resume()

	const stream = await initUserMedia()	
	const mediaRecorder = new MediaRecorder(stream)

  let delay = 0.7
  const beepDuration = 0.1
  const safety = 0.1

	for(let i = 0; i < beeps; i++) {
		const freq = 1000 + i * 200
		
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

    const measurementPromise = new Promise((resolve, reject) => {
      beepDetector.port.onmessage = event => { resolve(event.data) }
    })

	  await oac.startRendering()
	  beepDetector.port.postMessage('')
	  const measurement = await measurementPromise

    const result = evaluate(
      measurement, 
      beepDuration, 
      freq
    )

    const start = result.index / 1000
    const delta = delay - result.index / 1000
    delay = Math.max(start, (delay + (delay - start))) / 2 + 0.1

    resultCallback(freq, delta)

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
  const squares = freqs.map(f => Math.pow(f - freq, 2))

  const length = Math.floor(beepDuration * 1000)
  let bestIndex = 0
  let value = 0
  for(let i = 0; i < length; i++) {
    value += squares[i]
  }
  let leastSum = value
  let index = 1
  while(index + length < freqs.length) {
    value += squares[index + length]
    value -= squares[index - 1]
    if(value < leastSum) {
      leastSum = value
      bestIndex = index
    }
    index += 1
  }
  return {
    index: bestIndex, 
    coverage: leastSum
  }
}


