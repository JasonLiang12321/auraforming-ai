import { useState } from 'react'
import { uploadPdf } from '../services/api'

export default function PdfUploadForm() {
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const widgetNames = result?.widgetNames || []
  const shareHref = result?.share_url ? `${window.location.origin}${result.share_url}` : ''

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
      const data = await uploadPdf(file)
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="card uploadCard">
      <h2>Upload Blank PDF</h2>
      <p>Drop in a fillable form and generate a ready-to-share interview link in one step.</p>

      <form onSubmit={onSubmit} className="uploadForm">
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="fileInput"
          onChange={(event) => setFile(event.target.files?.[0] || null)}
        />
        <button type="submit" disabled={loading} className="btnPrimary">
          {loading ? 'Uploading...' : 'Upload PDF'}
        </button>
      </form>
      {file && <p className="hint">Selected file: {file.name}</p>}

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="uploadResult">
          <div className="metricRow">
            <p>
              File <strong>{result.filename}</strong>
            </p>
            <p>
              Agent <strong>{result.agent_id}</strong>
            </p>
          </div>

          <p className="shareRow">
            Share link{' '}
            <a href={shareHref} target="_blank" rel="noreferrer">
              {shareHref}
            </a>
          </p>

          <p>
            Fields detected <strong>{result.fieldCount}</strong>
          </p>
          {widgetNames.length > 0 ? (
            <ul className="fieldList">
              {widgetNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          ) : (
            <p>No fillable fields found in this PDF.</p>
          )}
        </div>
      )}
    </section>
  )
}
