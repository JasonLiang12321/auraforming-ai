import { useEffect, useMemo, useRef, useState } from 'react'
import { uploadPdf } from '../services/api'

const LOADING_STEPS = ['Uploading your form...', 'Reviewing fillable fields...', 'Preparing your guided interview link...']

export default function PdfUploadForm({ onCreated }) {
  const [file, setFile] = useState(null)
  const [agentName, setAgentName] = useState('')
  const [loading, setLoading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [loadingStep, setLoadingStep] = useState(0)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef(null)
  const shareHref = useMemo(
    () => (result?.share_url ? `${window.location.origin}${result.share_url}` : ''),
    [result?.share_url],
  )

  useEffect(() => {
    if (!loading) {
      setLoadingStep(0)
      return
    }

    const interval = setInterval(() => {
      setLoadingStep((prev) => (prev + 1) % LOADING_STEPS.length)
    }, 900)
    return () => clearInterval(interval)
  }, [loading])

  useEffect(() => {
    if (!copied) return
    const timeout = setTimeout(() => setCopied(false), 1400)
    return () => clearTimeout(timeout)
  }, [copied])

  const pickFile = () => inputRef.current?.click()
  const resetToCreateAnother = () => {
    setResult(null)
    setCopied(false)
    setError('')
    setFile(null)
  }

  const applySelectedFile = (nextFile) => {
    if (!nextFile) return
    if (nextFile.type !== 'application/pdf' && !nextFile.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are supported.')
      return
    }
    setError('')
    setFile(nextFile)
    if (!agentName.trim()) {
      const suggested = nextFile.name.replace(/\.pdf$/i, '').trim()
      if (suggested) setAgentName(suggested)
    }
  }

  const onDrop = (event) => {
    event.preventDefault()
    setDragActive(false)
    const droppedFile = event.dataTransfer.files?.[0] || null
    applySelectedFile(droppedFile)
  }

  const onCopy = async () => {
    if (!shareHref) return
    try {
      await navigator.clipboard.writeText(shareHref)
      setCopied(true)
    } catch {
      setError('Clipboard write failed. Copy manually from the link.')
    }
  }

  const onSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setResult(null)

    if (!file) {
      setError('Please select a PDF file first.')
      return
    }

    try {
      setLoading(true)
      const data = await uploadPdf(file, agentName)
      setResult(data)
      onCreated?.(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="card uploadCard">
      {!result ? (
        <>
          <h2>Create a Client Interview Link</h2>
          <p>Drop a fillable PDF and we will prepare a warm, guided experience for your client.</p>

          <form onSubmit={onSubmit} className="uploadForm">
            <label className="inputLabel" htmlFor="agent-name-input">
              Agent Name
            </label>
            <input
              id="agent-name-input"
              type="text"
              className="textInput"
              placeholder="e.g. Acme Onboarding Form"
              value={agentName}
              onChange={(event) => setAgentName(event.target.value)}
              maxLength={120}
            />
            <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => applySelectedFile(event.target.files?.[0] || null)} />
            <div
              role="button"
              tabIndex={0}
              className={dragActive ? 'dropZone active' : 'dropZone'}
              onClick={pickFile}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  pickFile()
                }
              }}
              onDragOver={(event) => {
                event.preventDefault()
                setDragActive(true)
              }}
              onDragLeave={(event) => {
                event.preventDefault()
                setDragActive(false)
              }}
              onDrop={onDrop}
            >
              <p className="dropZoneTitle">Drag and drop your blank PDF</p>
              <p className="dropZoneHint">or click to browse files</p>
              {file && <p className="dropZoneFile">{file.name}</p>}
            </div>
            <button type="submit" disabled={loading || !file} className="btnPrimary">
              {loading ? 'Preparing...' : 'Generate Share Link'}
            </button>
          </form>
          {loading && <p className="loadingLine">{LOADING_STEPS[loadingStep]}</p>}
          {error && <p className="error">{error}</p>}
        </>
      ) : (
        <>
          <div className="uploadSuccessHead">
            <p className="eyebrow">Success</p>
            <h2>Your Client Link Is Ready</h2>
            <p className="sharePrompt">Share this link with the person who needs to fill out this form.</p>
          </div>

        <div className="uploadResult reveal">
          <div className="metricRow">
            <p>
              Name <strong>{result.agent_name || 'Untitled Agent'}</strong>
            </p>
            <p>
              File <strong>{result.filename}</strong>
            </p>
            <p>
              Agent <strong>{result.agent_id}</strong>
            </p>
          </div>

          <div className="shareCard">
            <div>
              <p className="shareLabel">Shareable Client Link</p>
              <a className="shareHref" href={shareHref} target="_blank" rel="noreferrer">
                {shareHref}
              </a>
            </div>
            <button type="button" className="btnGhost" onClick={onCopy}>
              Copy to Clipboard
            </button>
          </div>
        </div>
          {copied && <p className="toast">Copied!</p>}
          <div className="resultActions">
            <a className="btnGhost btnLink" href="/admin/agents">
              View All Agents
            </a>
            <a className="btnPrimary btnLink" href={`/admin/agents/${encodeURIComponent(result.agent_id)}/intakes`}>
              View Intakes For This Agent
            </a>
            <button type="button" className="btnGhost" onClick={resetToCreateAnother}>
              Create Another Link
            </button>
          </div>
        </>
      )}
    </section>
  )
}
