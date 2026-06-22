import React, { useState } from "react";
import { Link } from "wouter";
import { 
  useGetTournaments,
  useCreateTournament,
  useActivateTournament,
  useGetPoolMembers,
  useCreatePoolMember,
  useForceRefresh,
  useGetTournamentField,
  useGetMemberPicks,
  useSavePicks,
  getGetTournamentFieldQueryKey
} from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";

export default function Admin() {
  const [password, setPassword] = useState(localStorage.getItem("admin_password") || "");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tournaments, refetch: refetchTournaments } = useGetTournaments();
  const { data: poolMembers, refetch: refetchMembers } = useGetPoolMembers();

  const createTournament = useCreateTournament();
  const activateTournament = useActivateTournament();
  const createMember = useCreatePoolMember();
  const forceRefresh = useForceRefresh();
  const savePicks = useSavePicks();

  const [newTourney, setNewTourney] = useState({ name: "", year: new Date().getFullYear(), espnId: "" });
  const [pgaEvents, setPgaEvents] = useState<{ espnEventId: string; name: string; date: string; state: string | null }[]>([]);
  React.useEffect(() => {
    if (!isAuthenticated) return;
    fetch("/api/admin/events")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setPgaEvents(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [isAuthenticated]);
  const [newMember, setNewMember] = useState("");
  const [editingEspnId, setEditingEspnId] = useState<string | null>(null);
  const [editingEspnValue, setEditingEspnValue] = useState("");
  
  const [pickTourneyId, setPickTourneyId] = useState("");
  const [pickMemberId, setPickMemberId] = useState("");

  const activeTournament = tournaments?.find(t => t.isActive);
  const selectedTourneyEspnId = tournaments?.find(t => t.id === pickTourneyId)?.espnEventId;

  const { data: field } = useGetTournamentField({ espnEventId: selectedTourneyEspnId || "" }, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: { enabled: !!selectedTourneyEspnId } as any,
  });

  const { data: existingPicks, refetch: refetchPicks } = useGetMemberPicks(pickTourneyId, pickMemberId, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: { enabled: !!pickTourneyId && !!pickMemberId } as any,
  });

  const [selectedGolfers, setSelectedGolfers] = useState<string[]>([]);

  // Update selected golfers when picks change
  React.useEffect(() => {
    if (existingPicks) {
      setSelectedGolfers(existingPicks.map((p: { id: string }) => p.id));
    } else {
      setSelectedGolfers([]);
    }
  }, [existingPicks]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsVerifying(true);
    try {
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        toast({ title: "Wrong password", description: "Check your password and try again.", variant: "destructive" });
        return;
      }
      localStorage.setItem("admin_password", password);
      setIsAuthenticated(true);
    } catch {
      toast({ title: "Could not reach server", variant: "destructive" });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("admin_password");
    setIsAuthenticated(false);
  };

  const handleExport = async () => {
    try {
      const res = await fetch("/api/admin/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        toast({ title: "Backup failed", description: "Could not export data.", variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `golf-pool-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Backup downloaded" });
    } catch {
      toast({ title: "Backup failed", description: "Could not reach server.", variant: "destructive" });
    }
  };

  const handle401 = () => {
    handleLogout();
    toast({ title: "Session expired", description: "Password may have changed. Please log in again.", variant: "destructive" });
  };

  const apiErr = (e: unknown) => (e as any)?.data?.error || (e as any)?.message || "An error occurred";
  const isUnauth = (e: unknown) => (e as any)?.status === 401 || (e as any)?.data?.error === "Invalid password";

  if (!isAuthenticated) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full bg-card p-8 rounded-xl border border-border shadow-2xl space-y-6">
          <h1 className="text-2xl font-bold text-primary uppercase tracking-wider text-center">Admin Access</h1>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <Input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full bg-background border-input"
              />
            </div>
            <Button type="submit" disabled={isVerifying} className="w-full uppercase tracking-wider font-bold">
              {isVerifying ? "Checking…" : "Login"}
            </Button>
          </form>
          <div className="text-center">
            <Link href="/" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              &larr; Back to Scoreboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const handleCreateTournament = () => {
    createTournament.mutate({
      data: {
        name: newTourney.name,
        year: newTourney.year,
        espnEventId: newTourney.espnId,
        password
      }
    }, {
      onSuccess: () => {
        toast({ title: "Tournament Created" });
        refetchTournaments();
        setNewTourney({ name: "", year: new Date().getFullYear(), espnId: "" });
      },
      onError: (e: unknown) => {
        if (isUnauth(e)) { handle401(); return; }
        toast({ title: "Error creating tournament", description: apiErr(e), variant: "destructive" });
      }
    });
  };

  const handleUpdateEspnId = async (tournamentId: string) => {
    if (!editingEspnValue.trim()) return;
    try {
      const res = await fetch(`/api/admin/tournament/${tournamentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ espnEventId: editingEspnValue.trim(), password }),
      });
      const data = await res.json();
      if (res.status === 401) { handle401(); return; }
      if (!res.ok) {
        toast({ title: "Error updating ESPN ID", description: data.error || res.statusText, variant: "destructive" });
        return;
      }
      toast({ title: "ESPN ID Updated", description: "Field re-fetched from ESPN." });
      setEditingEspnId(null);
      setEditingEspnValue("");
      refetchTournaments();
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleCreateMember = () => {
    createMember.mutate({
      data: { name: newMember, password }
    }, {
      onSuccess: () => {
        toast({ title: "Member Added" });
        refetchMembers();
        setNewMember("");
      },
      onError: (e: unknown) => {
        if (isUnauth(e)) { handle401(); return; }
        toast({ title: "Error adding member", description: apiErr(e), variant: "destructive" });
      }
    });
  };

  const handleActivate = (id: string) => {
    activateTournament.mutate({
      tournamentId: id,
      data: { password }
    }, {
      onSuccess: () => {
        toast({ title: "Tournament Activated" });
        refetchTournaments();
      },
      onError: (e: unknown) => {
        if (isUnauth(e)) { handle401(); return; }
        toast({ title: "Error activating tournament", description: apiErr(e), variant: "destructive" });
      }
    });
  };

  const handleForceRefresh = () => {
    if (!activeTournament) return;
    forceRefresh.mutate({
      data: { tournamentId: activeTournament.id, password }
    }, {
      onSuccess: () => toast({ title: "Refresh complete" }),
      onError: (e: unknown) => {
        if (isUnauth(e)) { handle401(); return; }
        toast({ title: "Error refreshing", description: apiErr(e), variant: "destructive" });
      }
    });
  };

  const handleSavePicks = () => {
    if (!pickTourneyId || !pickMemberId) return;
    savePicks.mutate({
      data: {
        tournamentId: pickTourneyId,
        poolMemberId: pickMemberId,
        golferIds: selectedGolfers,
        password
      }
    }, {
      onSuccess: () => {
        toast({ title: "Picks Saved" });
        refetchPicks();
      },
      onError: (e: unknown) => {
        if (isUnauth(e)) { handle401(); return; }
        toast({ title: "Error saving picks", description: apiErr(e), variant: "destructive" });
      }
    });
  };

  const toggleGolfer = (golferId: string) => {
    if (selectedGolfers.includes(golferId)) {
      setSelectedGolfers(selectedGolfers.filter(id => id !== golferId));
    } else {
      if (selectedGolfers.length >= 6) {
        toast({ title: "Limit Reached", description: "You can only select 6 golfers per team", variant: "destructive" });
        return;
      }
      setSelectedGolfers([...selectedGolfers, golferId]);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground p-4 md:p-8 pb-24 font-sans">
      <div className="max-w-5xl mx-auto space-y-8">
        <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-border pb-6">
          <h1 className="text-3xl font-bold text-primary uppercase tracking-widest">Tournament Admin</h1>
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={handleExport} className="border-border">Backup</Button>
            <Button variant="outline" onClick={handleLogout} className="border-border">Logout</Button>
            <Link href="/" className="text-muted-foreground hover:text-primary uppercase tracking-widest font-bold text-sm">
              Scoreboard &rarr;
            </Link>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Card className="bg-card border-card-border shadow-lg">
            <CardHeader className="bg-black/20 border-b border-border">
              <CardTitle className="text-xl uppercase tracking-wider text-primary">Tournaments</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="space-y-4">
                <h3 className="font-bold uppercase text-sm text-muted-foreground">Create New</h3>
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <Label>Pick from PGA schedule (optional)</Label>
                    <Select onValueChange={(id) => {
                      const ev = pgaEvents.find((e) => e.espnEventId === id);
                      if (ev) setNewTourney({ name: ev.name, year: parseInt(ev.date.slice(0, 4)) || new Date().getFullYear(), espnId: ev.espnEventId });
                    }}>
                      <SelectTrigger><SelectValue placeholder={pgaEvents.length ? "Choose an event to autofill…" : "Loading PGA schedule…"} /></SelectTrigger>
                      <SelectContent>
                        {pgaEvents.map((e) => (
                          <SelectItem key={e.espnEventId} value={e.espnEventId}>
                            {e.name} — {e.date.slice(0, 10)}{e.state === "in" ? " (live)" : e.state === "post" ? " (done)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Tournament Name</Label>
                    <Input value={newTourney.name} onChange={e => setNewTourney({...newTourney, name: e.target.value})} placeholder="e.g. The Masters" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Year</Label>
                      <Input type="number" value={newTourney.year} onChange={e => setNewTourney({...newTourney, year: parseInt(e.target.value)})} />
                    </div>
                    <div className="space-y-2">
                      <Label>ESPN Event ID</Label>
                      <Input value={newTourney.espnId} onChange={e => setNewTourney({...newTourney, espnId: e.target.value})} placeholder="e.g. 401580342" />
                    </div>
                  </div>
                  <Button onClick={handleCreateTournament} disabled={createTournament.isPending || !newTourney.name || !newTourney.espnId} className="uppercase font-bold tracking-wider">
                    {createTournament.isPending ? "Creating..." : "Create Tournament"}
                  </Button>
                </div>
              </div>

              <div className="space-y-4 pt-6 border-t border-border">
                <h3 className="font-bold uppercase text-sm text-muted-foreground">Existing Tournaments</h3>
                <div className="space-y-2">
                  {tournaments?.map(t => (
                    <div key={t.id} className="p-3 bg-background rounded-md border border-border space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-bold">{t.name} {t.year}</div>
                          <div className="text-xs text-muted-foreground">ESPN ID: {t.espnEventId || <span className="text-yellow-500">not set</span>}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {t.isActive ? (
                            <Badge className="bg-primary text-primary-foreground hover:bg-primary uppercase tracking-wider">Active</Badge>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => handleActivate(t.id)} disabled={activateTournament.isPending} className="uppercase text-xs tracking-wider">
                              Set Active
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => {
                            setEditingEspnId(editingEspnId === t.id ? null : t.id);
                            setEditingEspnValue(t.espnEventId || "");
                          }} className="text-xs text-muted-foreground hover:text-primary px-2">
                            Edit ID
                          </Button>
                        </div>
                      </div>
                      {editingEspnId === t.id && (
                        <div className="flex gap-2 pt-1">
                          <Input
                            value={editingEspnValue}
                            onChange={e => setEditingEspnValue(e.target.value)}
                            placeholder="ESPN Event ID"
                            className="h-8 text-sm bg-input border-border"
                            onKeyDown={e => { if (e.key === "Enter") handleUpdateEspnId(t.id); if (e.key === "Escape") { setEditingEspnId(null); setEditingEspnValue(""); } }}
                          />
                          <Button size="sm" onClick={() => handleUpdateEspnId(t.id)} disabled={!editingEspnValue.trim()} className="h-8 text-xs uppercase tracking-wider">
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setEditingEspnId(null); setEditingEspnValue(""); }} className="h-8 text-xs">
                            Cancel
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                  {tournaments?.length === 0 && (
                    <div className="text-sm text-muted-foreground text-center py-4">No tournaments found</div>
                  )}
                </div>
              </div>
              
              <div className="pt-6 border-t border-border">
                <Button 
                  variant="outline" 
                  className="w-full uppercase tracking-wider border-primary/50 text-primary hover:bg-primary/10" 
                  onClick={handleForceRefresh}
                  disabled={forceRefresh.isPending || !activeTournament}
                >
                  {forceRefresh.isPending ? "Refreshing..." : "Force ESPN Data Refresh"}
                </Button>
                <p className="text-xs text-muted-foreground mt-2 text-center">Refreshes active tournament data immediately</p>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-8">
            <Card className="bg-card border-card-border shadow-lg">
              <CardHeader className="bg-black/20 border-b border-border">
                <CardTitle className="text-xl uppercase tracking-wider text-primary">Pool Members</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="flex gap-2 items-end">
                  <div className="space-y-2 flex-1">
                    <Label>New Member Name</Label>
                    <Input value={newMember} onChange={e => setNewMember(e.target.value)} placeholder="e.g. John Doe" />
                  </div>
                  <Button onClick={handleCreateMember} disabled={createMember.isPending || !newMember} className="uppercase font-bold tracking-wider">Add</Button>
                </div>
                <div className="flex flex-wrap gap-2 pt-4">
                  {poolMembers?.map(m => (
                    <Badge key={m.id} variant="secondary" className="px-3 py-1 text-sm bg-background border border-border">{m.name}</Badge>
                  ))}
                  {poolMembers?.length === 0 && <span className="text-sm text-muted-foreground">No members added yet</span>}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-card-border shadow-lg">
              <CardHeader className="bg-black/20 border-b border-border">
                <CardTitle className="text-xl uppercase tracking-wider text-primary">Draft Picks</CardTitle>
                <CardDescription>Select 6 golfers per team</CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <Label>Tournament</Label>
                    <Select value={pickTourneyId} onValueChange={setPickTourneyId}>
                      <SelectTrigger className="bg-background border-border">
                        <SelectValue placeholder="Select tournament" />
                      </SelectTrigger>
                      <SelectContent>
                        {tournaments?.map(t => (
                          <SelectItem key={t.id} value={t.id}>{t.name} {t.year}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Pool Member</Label>
                    <Select value={pickMemberId} onValueChange={setPickMemberId}>
                      <SelectTrigger className="bg-background border-border">
                        <SelectValue placeholder="Select member" />
                      </SelectTrigger>
                      <SelectContent>
                        {poolMembers?.map(m => (
                          <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {pickTourneyId && pickMemberId && (
                  <div className="space-y-4 pt-4 border-t border-border">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold uppercase text-sm text-muted-foreground">Selected Golfers ({selectedGolfers.length}/6)</h3>
                      <Button size="sm" onClick={handleSavePicks} disabled={savePicks.isPending} className="uppercase tracking-wider font-bold">
                        {savePicks.isPending ? "Saving..." : "Save Picks"}
                      </Button>
                    </div>
                    
                    <div className="max-h-64 overflow-y-auto border border-border rounded-md bg-background p-2 grid grid-cols-1 gap-1">
                      {field?.map(golfer => {
                        const isSelected = selectedGolfers.includes(golfer.id);
                        return (
                          <div 
                            key={golfer.id} 
                            onClick={() => toggleGolfer(golfer.id)}
                            className={`p-2 rounded cursor-pointer flex justify-between items-center transition-colors ${isSelected ? 'bg-primary/20 border border-primary/50' : 'hover:bg-white/5 border border-transparent'}`}
                          >
                            <span className={isSelected ? "font-bold text-primary" : ""}>{golfer.name}</span>
                            {isSelected && <Badge className="bg-primary">Selected</Badge>}
                          </div>
                        );
                      })}
                      {(!field || field.length === 0) && (
                        <div className="p-4 text-center text-muted-foreground text-sm">
                          Field data not loaded. Make sure the ESPN ID is correct.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
