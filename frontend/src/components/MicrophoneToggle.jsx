import { useEffect, useRef, useState } from 'react'

export default function MicrophoneToggle() {
  const [isActive, setIsActive] = useState(false)
  const [error, setError] = useState('')
  const [permissionStatus, setPermissionStatus] = useState('idle')
  const streamRef = useRef(null)
  const mediaRecorderRef = useRef(null)

  useEffect(() => {
    return () => {
      // Cleanup: stop stream and recording on unmount
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
    }
  }, [])

  const handleToggle = async () => {
    if (isActive) {
      // Stop recording
      stopMicrophone()
    } else {
      // Start recording
      startMicrophone()
    }
  }

  const startMicrophone = async () => {
    setError('')
    setPermissionStatus('requesting')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })

      streamRef.current = stream
      setPermissionStatus('granted')

      // Initialize MediaRecorder for audio capture
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (e) => {
        // Audio data is available here
        // This can be sent to a backend or processed further
        console.log('Audio chunk received:', e.data)
      }

      mediaRecorder.onerror = (e) => {
        setError(`Recording error: ${e.error}`)
      }

      mediaRecorder.start()
      setIsActive(true)
    } catch (err) {
      setPermissionStatus('denied')
      if (err.name === 'NotAllowedError') {
        setError('Microphone access denied. Please allow access in your browser settings.')
      } else if (err.name === 'NotFoundError') {
        setError('No microphone device found.')
      } else {
        setError(`Failed to access microphone: ${err.message}`)
      }
    }
  }

  const stopMicrophone = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }

    setIsActive(false)
    setPermissionStatus('idle')
  }

  return (
    <div className="microphone-toggle">
      <button
        onClick={handleToggle}
        className={`mic-button ${isActive ? 'active' : 'inactive'}`}
        disabled={permissionStatus === 'requesting'}
      >
        <span className="mic-icon">🎤</span>
        <span className="mic-text">
          {permissionStatus === 'requesting'
            ? 'Requesting access...'
            : isActive
            ? 'Stop Listening'
            : 'Start Listening'}
        </span>
        {isActive && <span className="mic-indicator">● Recording</span>}
      </button>

      {error && <div className="error-message">{error}</div>}
      {isActive && <div className="status-message">Microphone is active</div>}
    </div>
  )
}
