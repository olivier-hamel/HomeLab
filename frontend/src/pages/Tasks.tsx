import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Button } from "../components/ui/button"
import { Badge } from "../components/ui/badge"
import { Target, MapPin, Clock, Users, AlertTriangle, CheckCircle, XCircle } from "lucide-react"

export default function Tasks() {

  const tasks = [
    {
      "id": "TASK-001",
      "name": "HOME ASSISTANT BACKUP",
      "status": "running",
      "type": "backup",
      "node": "pve-01",
      "target": "VM 100 / home-assistant",
      "progress": 75,
      "schedule": "Started: 16:40 UTC",
      "description": "Back up Home Assistant to the homelab datastore on pbs-01."
    },
    {
      "id": "TASK-002",
      "name": "DOCKER HOST SNAPSHOT",
      "status": "queued",
      "type": "snapshot",
      "node": "pve-01",
      "target": "VM 101 / docker-host",
      "progress": 0,
      "schedule": "Scheduled: 17:00 UTC",
      "description": "Create a snapshot before updating the Docker host."
    },
    {
      "id": "TASK-003",
      "name": "MONITORING BACKUP",
      "status": "completed",
      "type": "backup",
      "node": "pve-02",
      "target": "CT 104 / monitoring",
      "progress": 100,
      "schedule": "Finished: 02:10 UTC",
      "description": "Monitoring container backup completed and verified on pbs-01."
    },
    {
      "id": "TASK-004",
      "name": "RESTORE TEST",
      "status": "running",
      "type": "restore",
      "node": "pve-03",
      "target": "New VM 108 / restore-test",
      "progress": 35,
      "schedule": "Started: 16:42 UTC",
      "description": "Restore a backup into a new test VM to check recovery."
    },
    {
      "id": "TASK-005",
      "name": "FILESERVER BACKUP",
      "status": "failed",
      "type": "backup",
      "node": "pve-02",
      "target": "VM 106 / fileserver",
      "progress": 40,
      "schedule": "Stopped: 04:12 UTC",
      "description": "Backup stopped because the target storage on nas-01 is nearly full."
    }
  ]

  const getStatusColor = (status: string) => {
    switch (status) {
      case "running":
        return "bg-white/20 text-white"
      case "queued":
        return "bg-orange-500/20 text-orange-500"
      case "completed":
        return "bg-white/20 text-white"
      case "failed":
        return "bg-red-500/20 text-red-500"
      default:
        return "bg-neutral-500/20 text-neutral-300"
    }
  }

  const getTaskTypeColor = (type: string) => {
    switch (type) {
      case "restore":
        return "bg-red-500/20 text-red-500"
      case "snapshot":
        return "bg-orange-500/20 text-orange-500"
      case "backup":
        return "bg-neutral-500/20 text-neutral-300"
      case "migration":
        return "bg-white/20 text-white"
      default:
        return "bg-neutral-500/20 text-neutral-300"
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "running":
        return <Target className="w-4 h-4" />
      case "queued":
        return <Clock className="w-4 h-4" />
      case "completed":
        return <CheckCircle className="w-4 h-4" />
      case "failed":
        return <XCircle className="w-4 h-4" />
      default:
        return <AlertTriangle className="w-4 h-4" />
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wider">TASKS</h1>
          <p className="text-sm text-neutral-400">Backup, snapshot, and restore jobs across your homelab</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled title="Visual preview only" className="bg-orange-500 hover:bg-orange-600 text-white">Run Backup</Button>
          <Button disabled title="Visual preview only" className="bg-orange-500 hover:bg-orange-600 text-white">Task History</Button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-neutral-900 border-neutral-700">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-neutral-400 tracking-wider">RUNNING</p>
                <p className="text-2xl font-bold text-white font-mono">2</p>
              </div>
              <Target className="w-8 h-8 text-white" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-neutral-900 border-neutral-700">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-neutral-400 tracking-wider">COMPLETED</p>
                <p className="text-2xl font-bold text-white font-mono">1</p>
              </div>
              <CheckCircle className="w-8 h-8 text-white" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-neutral-900 border-neutral-700">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-neutral-400 tracking-wider">FAILED</p>
                <p className="text-2xl font-bold text-red-500 font-mono">1</p>
              </div>
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-neutral-900 border-neutral-700">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-neutral-400 tracking-wider">QUEUED</p>
                <p className="text-2xl font-bold text-white font-mono">1</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-white" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Task List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {tasks.map((task) => (
          <Card
            key={task.id}
            className="bg-neutral-900 border-neutral-700 hover:border-orange-500/50 transition-colors"

          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-sm font-bold text-white tracking-wider">{task.name}</CardTitle>
                  <p className="text-xs text-neutral-400 font-mono">{task.id}</p>
                </div>
                <div className="flex items-center gap-2">{getStatusIcon(task.status)}</div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge className={getStatusColor(task.status)}>{task.status.toUpperCase()}</Badge>
                <Badge className={getTaskTypeColor(task.type)}>{task.type.toUpperCase()}</Badge>
              </div>

              <p className="text-sm text-neutral-300">{task.description}</p>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-neutral-400">
                  <MapPin className="w-3 h-3" />
                  <span>{task.node}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-neutral-400">
                  <Users className="w-3 h-3" />
                  <span>Guest: {task.target}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-neutral-400">
                  <Clock className="w-3 h-3" />
                  <span>{task.schedule}</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-neutral-400">Progress</span>
                  <span className="text-white font-mono">{task.progress}%</span>
                </div>
                <div className="w-full bg-neutral-800 rounded-full h-2">
                  <div
                    className="bg-orange-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${task.progress}%` }}
                  ></div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

    </div>
  )
}
