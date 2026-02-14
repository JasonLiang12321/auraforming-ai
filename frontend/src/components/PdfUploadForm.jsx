import { useState } from 'react'
import { uploadPdf } from '../services/api'

export default function PdfUploadForm() {
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

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
    <section className="card">
      <h2>Upload Blank PDF</h2>
      <p>Extract fillable variable names from a PDF form.</p>

      <form onSubmit={onSubmit} className="uploadForm">
        <input
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => setFile(event.target.files?.[0] || null)}
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Uploading...' : 'Upload PDF'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="uploadResult">
          <p>
            <strong>File:</strong> {result.filename}
          </p>
          <p>
            <strong>Fields found:</strong> {result.fieldCount}
          </p>
          {result.fieldNames.length > 0 ? (
            <ul>
              {result.fieldNames.map((name) => (
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
