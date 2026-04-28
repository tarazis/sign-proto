import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'

const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:5173'
const PORT = process.env.PORT ?? 3001

const app = express()
app.use(cors({ origin: CLIENT_URL }))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: CLIENT_URL, methods: ['GET', 'POST'] },
})

io.on('connection', (socket) => {
  console.log(`[socket] connected: ${socket.id}`)

  socket.emit('welcome', { message: 'Connected to SignBridge server', socketId: socket.id })

  socket.on('disconnect', () => {
    console.log(`[socket] disconnected: ${socket.id}`)
  })
})

httpServer.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`)
})
