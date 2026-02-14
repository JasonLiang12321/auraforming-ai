import { useState } from 'react'
import { uploadPdf } from '../services/api'

export default function AdminPage() {
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const handleFileChange = (e) => {
    setFile(e.target.files[0])
    setError('')
  }

  const handleUpload = async (e) => {
    e.preventDefault()
    
    if (!file) {
      setError('Please select a file to upload')
      return
    }

    setUploading(true)
    setError('')
    setResult(null)

    try {
      const response = await uploadPdf(file)
      setResult(response)
      setFile(null)
      // Reset file input
      e.target.reset()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  const copyToClipboard = () => {
    if (result?.share_url) {
      const fullUrl = `${window.location.origin}/agent/${result.agent_id}`
      navigator.clipboard.writeText(fullUrl)
    }
  }

  return (
    <main className="container">
      <h1>Admin Dashboard</h1>
      
      <section className="card">
        <h2>Upload Blank PDF Form</h2>
        <p>Upload a fillable PDF to create a custom agent and generate a shareable link for your clients.</p>
        
        <form onSubmit={handleUpload}>
          <input
            type="file"
            accept=".pdf"
            onChange={handleFileChange}
            disabled={uploading}
            required
          />
          <button type="submit" disabled={uploading}>
            {uploading ? 'Uploading...' : 'Upload File'}
          </button>
        </form>
        
        {error && <p className="error">{error}</p>}
        
        {result && (
          <div className="uploadResult">
            <h3>✓ Agent Created Successfully!</h3>
            
            <div className="resultDetails">
              <p><strong>Filename:</strong> {result.filename}</p>
              <p><strong>Fields Detected:</strong> {result.fieldCount}</p>
              <p><strong>Agent ID:</strong> <code>{result.agent_id}</code></p>
            </div>
            
            <div className="shareableLink">
              <p><strong>Share this link with clients:</strong></p>
              <div className="linkContainer">
                <code>/agent/{result.agent_id}</code>
                <button type="button" className="copyBtn" onClick={copyToClipboard}>
                  Copy Link
                </button>
              </div>
            </div>

            {result.widgetNames && result.widgetNames.length > 0 && (
              <div className="widgetsList">
                <p><strong>Fillable Fields ({result.widgetNames.length}):</strong></p>
                <ul>
                  {result.widgetNames.map((field, idx) => (
                    <li key={idx}>{field}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  )
}
