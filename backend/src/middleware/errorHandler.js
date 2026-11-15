export function errorHandler(err, req, res, next) {
  console.error('Error:', err)

  if (err.message.includes('FOREIGN KEY')) {
    return res.status(400).json({ error: 'Invalid reference: check that the project or analysis exists' })
  }

  if (err.message.includes('UNIQUE')) {
    return res.status(409).json({ error: 'Duplicate entry' })
  }

  res.status(500).json({
    error: err.message || 'Internal Server Error',
    timestamp: new Date().toISOString()
  })
}
