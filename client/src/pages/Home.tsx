import { useNavigate } from 'react-router-dom'

export default function Home() {
  const navigate = useNavigate()

  function createRoom() {
    const roomId = crypto.randomUUID()
    navigate(`/room/${roomId}`)
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center gap-8">
      <h1 className="text-4xl font-bold tracking-tight">SignBridge</h1>
      <p className="text-gray-400 text-sm">Real-time peer connection</p>
      <button
        onClick={createRoom}
        className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-medium transition-colors"
      >
        Create Room
      </button>
    </div>
  )
}
