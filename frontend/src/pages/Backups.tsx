import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Badge } from "../components/ui/badge"
import { Search, FileText, Filter, Globe, Shield, AlertTriangle } from "lucide-react"

export default function Backups() {

  const backups = [
    {
      "id": "BKP-100-0905",
      "title": "HOME ASSISTANT",
      "guestType": "VM",
      "storage": "pbs-01 / homelab",
      "node": "pve-01",
      "date": "2026-09-05 02:00 UTC",
      "status": "verified",
      "size": "4.2 GiB",
      "summary": "Daily backup of VM 100. Verification completed successfully.",
      "tags": [
        "daily",
        "snapshot",
        "VM 100"
      ]
    },
    {
      "id": "BKP-101-0905",
      "title": "DOCKER HOST",
      "guestType": "VM",
      "storage": "pbs-01 / homelab",
      "node": "pve-01",
      "date": "2026-09-05 03:00 UTC",
      "status": "verified",
      "size": "8.6 GiB",
      "summary": "Daily backup of VM 101, including the Docker host and its application data.",
      "tags": [
        "daily",
        "snapshot",
        "VM 101"
      ]
    },
    {
      "id": "BKP-102-0905",
      "title": "MEDIA SERVER",
      "guestType": "LXC",
      "storage": "pbs-01 / homelab",
      "node": "pve-02",
      "date": "2026-09-05 03:30 UTC",
      "status": "pending",
      "size": "6.3 GiB",
      "summary": "Container backup completed. Verification is queued.",
      "tags": [
        "daily",
        "verification queued",
        "CT 102"
      ]
    },
    {
      "id": "BKP-106-0905",
      "title": "FILESERVER",
      "guestType": "VM",
      "storage": "nas-01 / backups",
      "node": "pve-02",
      "date": "2026-09-05 04:12 UTC",
      "status": "failed",
      "size": "Incomplete",
      "summary": "Backup stopped because nas-01 storage is nearly full. No new restore point was created.",
      "tags": [
        "weekly",
        "retry needed",
        "VM 106"
      ]
    },
    {
      "id": "BKP-104-0905",
      "title": "MONITORING",
      "guestType": "LXC",
      "storage": "pbs-01 / homelab",
      "node": "pve-02",
      "date": "2026-09-05 02:10 UTC",
      "status": "verified",
      "size": "780 MiB",
      "summary": "Monitoring container backup completed and verified.",
      "tags": [
        "daily",
        "snapshot",
        "CT 104"
      ]
    }
  ]

  const getGuestTypeColor = (guestType: string) => {
    switch (guestType) {
      case "VM":
        return "bg-orange-500/20 text-orange-500"
      case "LXC":
        return "bg-neutral-500/20 text-neutral-300"
      case "Host":
        return "bg-neutral-500/20 text-neutral-300"
      default:
        return "bg-white/20 text-white"
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "verified":
        return "bg-white/20 text-white"
      case "pending":
        return "bg-orange-500/20 text-orange-500"
      case "failed":
        return "bg-red-500/20 text-red-500"
      default:
        return "bg-neutral-500/20 text-neutral-300"
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wider">BACKUPS</h1>
          <p className="text-sm text-neutral-400">Backup history, verification status, and restore points</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled title="Visual preview only" className="bg-orange-500 hover:bg-orange-600 text-white">Back Up Now</Button>
          <Button disabled title="Visual preview only" className="bg-orange-500 hover:bg-orange-600 text-white">
            <Filter className="w-4 h-4 mr-2" />
            Filter
          </Button>
        </div>
      </div>

      {/* Stats and Search */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <Card className="lg:col-span-2 bg-neutral-900 border-neutral-700">
          <CardContent className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <Input disabled aria-label="Search backups (preview)"
                placeholder="Search backups..."

                className="pl-10 bg-neutral-800 border-neutral-600 text-white placeholder-neutral-400"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-neutral-900 border-neutral-700">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-neutral-400 tracking-wider">BACKUP RUNS</p>
                <p className="text-2xl font-bold text-white font-mono">5</p>
              </div>
              <FileText className="w-8 h-8 text-white" />
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
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-neutral-900 border-neutral-700">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-neutral-400 tracking-wider">VERIFIED</p>
                <p className="text-2xl font-bold text-white font-mono">3</p>
              </div>
              <Globe className="w-8 h-8 text-white" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Backup History */}
      <Card className="bg-neutral-900 border-neutral-700">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-neutral-300 tracking-wider">BACKUP HISTORY</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {backups.map((backup) => (
              <div
                key={backup.id}
                className="border border-neutral-700 rounded p-4 hover:border-orange-500/50 transition-colors"

              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-start gap-3">
                      <FileText className="w-5 h-5 text-neutral-400 mt-0.5" />
                      <div className="flex-1">
                        <h3 className="text-sm font-bold text-white tracking-wider">{backup.title}</h3>
                        <p className="text-xs text-neutral-400 font-mono">{backup.id}</p>
                      </div>
                    </div>

                    <p className="text-sm text-neutral-300 ml-8">{backup.summary}</p>

                    <div className="flex flex-wrap gap-2 ml-8">
                      {backup.tags.map((tag) => (
                        <Badge key={tag} className="bg-neutral-800 text-neutral-300 text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col sm:items-end gap-2">
                    <div className="flex flex-wrap gap-2">
                      <Badge className={getGuestTypeColor(backup.guestType)}>{backup.guestType}</Badge>
                      <Badge className="bg-neutral-500/20 text-neutral-300">{backup.size}</Badge>
                      <Badge className={getStatusColor(backup.status)}>{backup.status.toUpperCase()}</Badge>
                    </div>

                    <div className="text-xs text-neutral-400 space-y-1">
                      <div className="flex items-center gap-2">
                        <Globe className="w-3 h-3" />
                        <span>{backup.node}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Shield className="w-3 h-3" />
                        <span>{backup.storage}</span>
                      </div>
                      <div className="font-mono">{backup.date}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
