import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Button } from "../components/ui/button"
import { Badge } from "../components/ui/badge"
import { Progress } from "../components/ui/progress"
import {
  Server,
  Database,
  Shield,
  Wifi,
  HardDrive,
  Cpu,
  Activity,
  AlertTriangle,
  CheckCircle,
  Settings,
} from "lucide-react"

export default function Infrastructure() {

  const hosts = [
    {
      "id": "pve-01",
      "name": "PVE-01",
      "type": "Proxmox node",
      "status": "online",
      "cpu": 24,
      "memory": 48,
      "storage": 42,
      "uptime": "12 days",
      "network": "vmbr0 / VLAN 10"
    },
    {
      "id": "pve-02",
      "name": "PVE-02",
      "type": "Proxmox node",
      "status": "online",
      "cpu": 38,
      "memory": 62,
      "storage": 57,
      "uptime": "12 days",
      "network": "vmbr0 / VLAN 10"
    },
    {
      "id": "pve-03",
      "name": "PVE-03",
      "type": "Proxmox node",
      "status": "online",
      "cpu": 16,
      "memory": 35,
      "storage": 31,
      "uptime": "12 days",
      "network": "vmbr0 / VLAN 10"
    },
    {
      "id": "pbs-01",
      "name": "PBS-01",
      "type": "Backup server",
      "status": "online",
      "cpu": 8,
      "memory": 28,
      "storage": 64,
      "uptime": "18 days",
      "network": "VLAN 20 / Storage"
    },
    {
      "id": "nas-01",
      "name": "NAS-01",
      "type": "NAS",
      "status": "warning",
      "cpu": 12,
      "memory": 41,
      "storage": 89,
      "uptime": "32 days",
      "network": "VLAN 20 / Storage"
    },
    {
      "id": "tailscale-router",
      "name": "TAILSCALE ROUTER",
      "type": "Subnet router",
      "status": "online",
      "cpu": 3,
      "memory": 18,
      "storage": 14,
      "uptime": "12 days",
      "network": "Tailnet / Home LAN"
    }
  ]

  const getStatusColor = (status: string) => {
    switch (status) {
      case "online":
        return "bg-white/20 text-white"
      case "warning":
        return "bg-orange-500/20 text-orange-500"
      case "maintenance":
        return "bg-neutral-500/20 text-neutral-300"
      case "offline":
        return "bg-red-500/20 text-red-500"
      default:
        return "bg-neutral-500/20 text-neutral-300"
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "online":
        return <CheckCircle className="w-4 h-4" />
      case "warning":
        return <AlertTriangle className="w-4 h-4" />
      case "maintenance":
        return <Settings className="w-4 h-4" />
      case "offline":
        return <AlertTriangle className="w-4 h-4" />
      default:
        return <Activity className="w-4 h-4" />
    }
  }

  const getSystemIcon = (type: string) => {
    switch (type) {
      case "Proxmox node":
        return <Server className="w-6 h-6" />
      case "Backup server":
        return <Database className="w-6 h-6" />
      case "Firewall host":
        return <Shield className="w-6 h-6" />
      case "Subnet router":
        return <Wifi className="w-6 h-6" />
      case "NAS":
        return <HardDrive className="w-6 h-6" />
      case "Compute host":
        return <Cpu className="w-6 h-6" />
      default:
        return <Server className="w-6 h-6" />
    }
  }

  const getStorageColor = (used: number) => {
    if (used >= 95) return "text-red-500"
    if (used >= 85) return "text-orange-500"
    return "text-white"
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wider">INFRASTRUCTURE</h1>
          <p className="text-sm text-neutral-400">Proxmox nodes, backup storage, and Tailscale connectivity</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled title="Visual preview only" className="bg-orange-500 hover:bg-orange-600 text-white">Refresh Status</Button>
          <Button disabled title="Visual preview only" className="bg-orange-500 hover:bg-orange-600 text-white">Node Settings</Button>
        </div>
      </div>

      {/* Infrastructure Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-neutral-900 border-neutral-700">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-neutral-400 tracking-wider">PROXMOX NODES</p>
                <p className="text-2xl font-bold text-white font-mono">3/3</p>
              </div>
              <CheckCircle className="w-8 h-8 text-white" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-neutral-900 border-neutral-700">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-neutral-400 tracking-wider">STORAGE ALERTS</p>
                <p className="text-2xl font-bold text-orange-500 font-mono">1</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-neutral-900 border-neutral-700">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-neutral-400 tracking-wider">CLUSTER UPTIME</p>
                <p className="text-2xl font-bold text-white font-mono">12d</p>
              </div>
              <Activity className="w-8 h-8 text-white" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-neutral-900 border-neutral-700">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-neutral-400 tracking-wider">MANAGED HOSTS</p>
                <p className="text-2xl font-bold text-neutral-300 font-mono">6</p>
              </div>
              <Settings className="w-8 h-8 text-neutral-300" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Host Inventory */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {hosts.map((host) => (
          <Card
            key={host.id}
            className="bg-neutral-900 border-neutral-700 hover:border-orange-500/50 transition-colors"

          >
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {getSystemIcon(host.type)}
                  <div>
                    <CardTitle className="text-sm font-bold text-white tracking-wider">{host.name}</CardTitle>
                    <p className="text-xs text-neutral-400">{host.type}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusIcon(host.status)}
                  <Badge className={getStatusColor(host.status)}>{host.status.toUpperCase()}</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-400">STORAGE USED</span>
                <span className={`text-sm font-bold font-mono ${getStorageColor(host.storage)}`}>{host.storage}%</span>
              </div>
              <Progress value={host.storage} aria-label={`${host.name} storage used`} className="h-2" />

              <div className="grid grid-cols-3 gap-4 text-xs">
                <div>
                  <div className="text-neutral-400 mb-1">CPU</div>
                  <div className="text-white font-mono">{host.cpu}%</div>
                  <div className="w-full bg-neutral-800 rounded-full h-1 mt-1">
                    <div
                      className="bg-orange-500 h-1 rounded-full transition-all duration-300"
                      style={{ width: `${host.cpu}%` }}
                    ></div>
                  </div>
                </div>
                <div>
                  <div className="text-neutral-400 mb-1">MEMORY</div>
                  <div className="text-white font-mono">{host.memory}%</div>
                  <div className="w-full bg-neutral-800 rounded-full h-1 mt-1">
                    <div
                      className="bg-orange-500 h-1 rounded-full transition-all duration-300"
                      style={{ width: `${host.memory}%` }}
                    ></div>
                  </div>
                </div>
                <div>
                  <div className="text-neutral-400 mb-1">DISK</div>
                  <div className="text-white font-mono">{host.storage}%</div>
                  <div className="w-full bg-neutral-800 rounded-full h-1 mt-1">
                    <div
                      className="bg-orange-500 h-1 rounded-full transition-all duration-300"
                      style={{ width: `${host.storage}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              <div className="space-y-1 text-xs text-neutral-400">
                <div className="flex justify-between">
                  <span>Uptime:</span>
                  <span className="text-white font-mono">{host.uptime}</span>
                </div>
                <div className="flex justify-between">
                  <span>Network:</span>
                  <span className="text-white">{host.network}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

    </div>
  )
}
