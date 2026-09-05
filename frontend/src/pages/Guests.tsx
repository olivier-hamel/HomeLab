import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Search, Filter, MoreHorizontal, MapPin, Clock, Shield } from "lucide-react"

export default function Guests() {

  const guests = [
    {
      "id": "100",
      "name": "home-assistant",
      "status": "running",
      "node": "pve-01",
      "uptime": "12 days",
      "vcpus": 2,
      "type": "VM"
    },
    {
      "id": "101",
      "name": "docker-host",
      "status": "running",
      "node": "pve-01",
      "uptime": "7 days",
      "vcpus": 4,
      "type": "VM"
    },
    {
      "id": "102",
      "name": "media-server",
      "status": "running",
      "node": "pve-02",
      "uptime": "5 days",
      "vcpus": 4,
      "type": "LXC"
    },
    {
      "id": "103",
      "name": "ubuntu-template",
      "status": "template",
      "node": "pve-03",
      "uptime": "Not running",
      "vcpus": 2,
      "type": "VM"
    },
    {
      "id": "104",
      "name": "monitoring",
      "status": "running",
      "node": "pve-02",
      "uptime": "12 days",
      "vcpus": 2,
      "type": "LXC"
    },
    {
      "id": "105",
      "name": "dev-sandbox",
      "status": "stopped",
      "node": "pve-03",
      "uptime": "Not running",
      "vcpus": 2,
      "type": "VM"
    },
    {
      "id": "106",
      "name": "fileserver",
      "status": "running",
      "node": "pve-02",
      "uptime": "9 days",
      "vcpus": 4,
      "type": "VM"
    },
    {
      "id": "107",
      "name": "git-server",
      "status": "running",
      "node": "pve-03",
      "uptime": "3 days",
      "vcpus": 2,
      "type": "VM"
    }
  ]

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wider">VMS & CONTAINERS</h1>
          <p className="text-sm text-neutral-400">Virtual machines and LXC containers across your Proxmox nodes</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled title="Visual preview only" className="bg-orange-500 hover:bg-orange-600 text-white">Create Guest</Button>
          <Button disabled title="Visual preview only" className="bg-orange-500 hover:bg-orange-600 text-white">
            <Filter className="w-4 h-4 mr-2" />
            Filter
          </Button>
        </div>
      </div>

      {/* Search and Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Card className="lg:col-span-1 bg-neutral-900 border-neutral-700">
          <CardContent className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <Input disabled aria-label="Search VMs and containers (preview)"
                placeholder="Search guests..."

                className="pl-10 bg-neutral-800 border-neutral-600 text-white placeholder-neutral-400"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-neutral-900 border-neutral-700">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-neutral-400 tracking-wider">RUNNING</p>
                <p className="text-2xl font-bold text-white font-mono">6</p>
              </div>
              <Shield className="w-8 h-8 text-white" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-neutral-900 border-neutral-700">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-neutral-400 tracking-wider">STOPPED</p>
                <p className="text-2xl font-bold text-red-500 font-mono">1</p>
              </div>
              <Shield className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-neutral-900 border-neutral-700">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-neutral-400 tracking-wider">TEMPLATES</p>
                <p className="text-2xl font-bold text-orange-500 font-mono">1</p>
              </div>
              <Shield className="w-8 h-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Guest List */}
      <Card className="bg-neutral-900 border-neutral-700">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-neutral-300 tracking-wider">GUEST INVENTORY</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-neutral-700">
                  <th className="text-left py-3 px-4 text-xs font-medium text-neutral-400 tracking-wider">VMID</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-neutral-400 tracking-wider">NAME</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-neutral-400 tracking-wider">STATUS</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-neutral-400 tracking-wider">NODE</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-neutral-400 tracking-wider">UPTIME</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-neutral-400 tracking-wider">VCPUS</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-neutral-400 tracking-wider">TYPE</th>
                  <th className="text-left py-3 px-4 text-xs font-medium text-neutral-400 tracking-wider">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {guests.map((guest, index) => (
                  <tr
                    key={guest.id}
                    className={`border-b border-neutral-800 hover:bg-neutral-800 transition-colors ${
                      index % 2 === 0 ? "bg-neutral-900" : "bg-neutral-850"
                    }`}

                  >
                    <td className="py-3 px-4 text-sm text-white font-mono">{guest.id}</td>
                    <td className="py-3 px-4 text-sm text-white">{guest.name}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            guest.status === "running"
                              ? "bg-white"
                              : guest.status === "stopped"
                                ? "bg-neutral-500"
                                : guest.status === "template"
                                  ? "bg-orange-500"
                                  : "bg-red-500"
                          }`}
                        ></div>
                        <span className="text-xs text-neutral-300 uppercase tracking-wider">{guest.status}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-3 h-3 text-neutral-400" />
                        <span className="text-sm text-neutral-300">{guest.node}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <Clock className="w-3 h-3 text-neutral-400" />
                        <span className="text-sm text-neutral-300 font-mono">{guest.uptime}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-sm text-white font-mono">{guest.vcpus}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-xs px-2 py-1 rounded uppercase tracking-wider ${
                          guest.type === "VM" ? "bg-orange-500/20 text-orange-500" : "bg-neutral-500/20 text-neutral-300"
                        }`}
                      >
                        {guest.type}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <Button disabled title="Visual preview only" aria-label="Guest actions (preview)" variant="ghost" size="icon" className="text-neutral-400 hover:text-orange-500">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
