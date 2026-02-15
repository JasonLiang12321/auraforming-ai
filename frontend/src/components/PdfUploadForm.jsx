import { useEffect, useMemo, useRef, useState } from 'react'
import { uploadPdf } from '../services/api'
import { useI18n } from '../i18n/I18nProvider'

export default function PdfUploadForm({ onCreated }) {
  const { t } = useI18n()
  const [file, setFile] = useState(null)
  const [agentName, setAgentName] = useState('')
  const [loading, setLoading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [loadingStep, setLoadingStep] = useState(0)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)
  const inputRef = useRef(null)
  const loadingSteps = useMemo(
    () => [t('upload_step_upload'), t('upload_step_review'), t('upload_step_prepare')],
    [t],
  )
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
      setLoadingStep((prev) => (prev + 1) % loadingSteps.length)
    }, 900)
    return () => clearInterval(interval)
  }, [loading, loadingSteps.length])

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
      setError(t('upload_error_pdf_only'))
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
      setError(t('upload_error_clipboard'))
    }
  }

  const onSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setResult(null)

    if (!file) {
      setError(t('upload_error_select_pdf'))
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
          <h2>{t('upload_title')}</h2>
          <p>{t('upload_subtitle')}</p>

          <form onSubmit={onSubmit} className="uploadForm">
            <label className="inputLabel" htmlFor="agent-name-input">
              {t('upload_agent_name')}
            </label>
            <input
              id="agent-name-input"
              type="text"
              className="textInput"
              placeholder={t('upload_agent_name_placeholder')}
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
              <p className="dropZoneTitle">{t('upload_drop_title')}</p>
              <p className="dropZoneHint">{t('upload_drop_hint')}</p>
              {file && <p className="dropZoneFile">{file.name}</p>}
            </div>
            <button type="submit" disabled={loading || !file} className="btnPrimary">
              {loading ? t('upload_prepare') : t('upload_generate_link')}
            </button>
          </form>
          {loading && <p className="loadingLine">{loadingSteps[loadingStep]}</p>}
          {error && <p className="error">{error}</p>}
        </>
      ) : (
        <>
          <div className="uploadSuccessHead">
            <p className="eyebrow">{t('upload_success')}</p>
            <h2>{t('upload_success_title')}</h2>
            <p className="sharePrompt">{t('upload_success_subtitle')}</p>
          </div>

        <div className="uploadResult reveal">
          <div className="metricRow">
            <p>
              {t('upload_name')} <strong>{result.agent_name || t('agents_untitled')}</strong>
            </p>
            <p>
              {t('upload_file')} <strong>{result.filename}</strong>
            </p>
            <p>
              {t('upload_agent')} <strong>{result.agent_id}</strong>
            </p>
          </div>

          <div className="shareCard">
            <div>
              <p className="shareLabel">{t('upload_shareable_link')}</p>
              <a className="shareHref" href={shareHref} target="_blank" rel="noreferrer">
                {shareHref}
              </a>
            </div>
            <button type="button" className="btnGhost" onClick={onCopy}>
              {t('upload_copy_clipboard')}
            </button>
          </div>
        </div>
          {copied && <p className="toast">{t('upload_copied')}</p>}
          <div className="resultActions">
            <a className="btnGhost btnLink" href="/admin/agents">
              {t('upload_view_agents')}
            </a>
            <a className="btnPrimary btnLink" href={`/admin/agents/${encodeURIComponent(result.agent_id)}/intakes`}>
              {t('upload_view_intakes')}
            </a>
            <button type="button" className="btnGhost" onClick={resetToCreateAnother}>
              {t('upload_create_another')}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
