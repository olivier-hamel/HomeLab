import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";

const recentGuests = [
  { id: "VM 100", name: "home-assistant", status: "running" },
  { id: "VM 101", name: "docker-host", status: "running" },
  { id: "CT 102", name: "media-server", status: "running" },
  { id: "VM 105", name: "dev-sandbox", status: "stopped" },
];

const activity = [
  { time: "16:44 UTC", resource: "VM 100", message: "Backup to pbs-01 is running on pve-01." },
  { time: "16:42 UTC", resource: "pve-03", message: "Started a restore test into new VM 108." },
  { time: "16:30 UTC", resource: "tailscale-router", message: "Connected to the tailnet. Home LAN route is available." },
  { time: "04:12 UTC", resource: "VM 106", message: "Backup failed. Target storage on nas-01 is nearly full." },
  { time: "02:10 UTC", resource: "CT 104", message: "Monitoring backup completed and verified on pbs-01." },
];

export default function Overview() {
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <Card className="lg:col-span-4 bg-neutral-900 border-neutral-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-neutral-300 tracking-wider">GUEST STATUS</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 mb-6">
              {[{ label: "Running", count: 6 }, { label: "Stopped", count: 1 }, { label: "Templates", count: 1 }].map((item) => (
                <div key={item.label} className="text-center">
                  <div className="text-2xl font-bold text-white font-mono">{item.count}</div>
                  <div className="text-xs text-neutral-500">{item.label}</div>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {recentGuests.map((guest) => (
                <div key={guest.id} className="flex items-center justify-between p-2 bg-neutral-800 rounded hover:bg-neutral-700 transition-colors">
                  <div className="flex items-center gap-3">
                    <div title={guest.status} className={`w-2 h-2 rounded-full ${guest.status === "running" ? "bg-white" : "bg-neutral-500"}`} />
                    <div>
                      <div className="text-xs text-white font-mono">{guest.id}<span className="sr-only">, {guest.status}</span></div>
                      <div className="text-xs text-neutral-500">{guest.name}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-4 bg-neutral-900 border-neutral-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-neutral-300 tracking-wider">RECENT ACTIVITY</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {activity.map((event) => (
                <div key={event.time} className="text-xs border-l-2 border-orange-500 pl-3 hover:bg-neutral-800 p-2 rounded transition-colors">
                  <div className="text-neutral-500 font-mono">{event.time}</div>
                  <div className="text-white">
                    <span className="text-orange-500 font-mono">{event.resource}</span>{" "}{event.message}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-4 bg-neutral-900 border-neutral-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-neutral-300 tracking-wider">TAILSCALE NETWORK</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <div aria-hidden="true" className="relative w-32 h-32 mb-4">
              <div className="absolute inset-0 border-2 border-white rounded-full opacity-60 animate-pulse" />
              <div className="absolute inset-2 border border-white rounded-full opacity-40" />
              <div className="absolute inset-4 border border-white rounded-full opacity-20" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-full h-px bg-white opacity-30" />
              </div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-px h-full bg-white opacity-30" />
              </div>
            </div>
            <div className="text-xs text-neutral-500 space-y-1 w-full font-mono">
              <div># DEMO TAILNET / 16:45 UTC</div>
              <div className="text-white">{"> tailscale-router: connected"}</div>
              <div className="text-orange-500">{"> subnet: 192.168.10.0/24"}</div>
              <div className="text-white">{"> peers: 5 online"}</div>
              <div className="text-neutral-400">{"> route: home LAN via subnet router"}</div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-8 bg-neutral-900 border-neutral-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-neutral-300 tracking-wider">CLUSTER UTILIZATION</CardTitle>
            <p className="text-xs text-neutral-500">
              Last 24 hours · <span className="text-orange-500">CPU</span> / <span className="text-white">Memory</span>
            </p>
          </CardHeader>
          <CardContent>
            <div className="h-48 relative" role="img" aria-label="Sample CPU and memory utilization over the last 24 hours">
              <div className="absolute inset-0 grid grid-cols-8 grid-rows-6 opacity-20">
                {Array.from({ length: 48 }).map((_, index) => <div key={index} className="border border-neutral-700" />)}
              </div>
              <svg viewBox="0 0 350 192" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 w-full h-full">
                <polyline points="0,120 50,100 100,110 150,90 200,95 250,85 300,100 350,80" fill="none" stroke="#f97316" strokeWidth="2" />
                <polyline points="0,140 50,135 100,130 150,125 200,130 250,135 300,125 350,120" fill="none" stroke="#ffffff" strokeWidth="2" strokeDasharray="5,5" />
              </svg>
              <div className="absolute left-0 top-0 h-full flex flex-col justify-between text-xs text-neutral-500 -ml-5 font-mono">
                <span>100%</span><span>75%</span><span>50%</span><span>25%</span>
              </div>
              <div className="absolute bottom-0 left-0 w-full flex justify-between text-xs text-neutral-500 -mb-6 font-mono">
                <span>24 hours ago</span><span>Now</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-4 bg-neutral-900 border-neutral-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-neutral-300 tracking-wider">LAB SUMMARY</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 bg-white rounded-full" />
                  <span className="text-xs text-white font-medium">Guest inventory</span>
                </div>
                <div className="space-y-2">
                  {[{ label: "Virtual machines", count: 6 }, { label: "LXC containers", count: 2 }, { label: "Running guests", count: 6 }].map((item) => (
                    <div key={item.label} className="flex justify-between text-xs">
                      <span className="text-neutral-400">{item.label}</span>
                      <span className="text-white font-bold font-mono">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 bg-orange-500 rounded-full" />
                  <span className="text-xs text-orange-500 font-medium">Needs attention</span>
                </div>
                <div className="space-y-2">
                  {[{ label: "Failed tasks", count: 1 }, { label: "Storage alerts", count: 1 }, { label: "Pending verification", count: 1 }].map((item) => (
                    <div key={item.label} className="flex justify-between text-xs">
                      <span className="text-neutral-400">{item.label}</span>
                      <span className="text-white font-bold font-mono">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
