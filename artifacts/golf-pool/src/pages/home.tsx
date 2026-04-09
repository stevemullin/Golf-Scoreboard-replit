import React, { useState, useEffect } from "react";
import { Link } from "wouter";
import { 
  useGetScoreboard, 
  useGetManualScoreboard, 
  useGetTournaments, 
  useUpdateManualScore,
  getGetScoreboardQueryKey
} from "@workspace/api-client-react";
import { formatScore } from "@/lib/score";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";

export default function Home() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"live" | "manual">("live");
  
  const { data: scoreboard, isLoading } = useGetScoreboard({
    query: {
      refetchInterval: 60000,
    }
  });

  const { data: manualScoreboard } = useGetManualScoreboard({
    query: {
      enabled: mode === "manual"
    }
  });

  const updateScore = useUpdateManualScore();

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  const [editName, setEditName] = useState(() => localStorage.getItem("golf_pool_editor") || "");

  useEffect(() => {
    localStorage.setItem("golf_pool_editor", editName);
  }, [editName]);

  const handleSaveManualScore = (tournamentId: string, poolMemberId: string, scores: {r1?: number|null, r2?: number|null, r3?: number|null, r4?: number|null}) => {
    updateScore.mutate({
      data: {
        tournamentId,
        poolMemberId,
        ...scores,
        updatedBy: editName || "Anonymous"
      }
    });
  };

  const scrollToTeam = (memberId: string) => {
    const el = document.getElementById(`team-${memberId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const activeTournament = scoreboard?.tournament;

  return (
    <div className="min-h-[100dvh] bg-background text-foreground p-4 md:p-8 font-sans pb-24">
      <div className="max-w-7xl mx-auto space-y-8">
        <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-border pb-6">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-primary uppercase tracking-wider">
              {activeTournament?.name || "Golf Pool"}
            </h1>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground font-mono">
              <span>{activeTournament?.status === "completed" ? "Final" : `Round ${activeTournament?.currentRound || 1}`}</span>
              {scoreboard?.lastUpdated && (
                <span>| Updated: {new Date(scoreboard.lastUpdated).toLocaleTimeString()}</span>
              )}
            </div>
          </div>
          <div className="flex flex-col md:flex-row items-center gap-4">
            <div className="flex items-center gap-2 bg-card px-4 py-2 rounded-lg border border-border">
              <span className={`text-sm font-bold ${mode === 'live' ? 'text-primary' : 'text-muted-foreground'}`}>Live</span>
              <Switch 
                checked={mode === "manual"} 
                onCheckedChange={(c) => setMode(c ? "manual" : "live")} 
              />
              <span className={`text-sm font-bold ${mode === 'manual' ? 'text-primary' : 'text-muted-foreground'}`}>Manual</span>
            </div>
            <Link href="/admin" className="text-sm font-bold text-primary border border-primary/30 px-4 py-2 rounded-lg hover:bg-primary/10 transition-colors uppercase tracking-widest">
              Admin
            </Link>
          </div>
        </header>

        {isLoading && !scoreboard ? (
          <div className="animate-pulse space-y-8">
            <div className="h-96 bg-card/50 rounded-xl border border-border"></div>
            <div className="h-64 bg-card/50 rounded-xl border border-border"></div>
          </div>
        ) : (
          <main className="space-y-12">
            <Card className="bg-card border-card-border overflow-hidden rounded-xl shadow-xl shadow-black/50">
              <Table>
                <TableHeader className="bg-black/40">
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="w-16 text-center text-muted-foreground uppercase font-bold text-xs tracking-wider">Pos</TableHead>
                    <TableHead className="text-muted-foreground uppercase font-bold text-xs tracking-wider">Player</TableHead>
                    <TableHead className="text-right text-muted-foreground uppercase font-bold text-xs tracking-wider">Total</TableHead>
                    <TableHead className="text-right text-muted-foreground uppercase font-bold text-xs tracking-wider hidden sm:table-cell">Thru</TableHead>
                    <TableHead className="text-right text-muted-foreground uppercase font-bold text-xs tracking-wider hidden sm:table-cell">Today</TableHead>
                    <TableHead className="text-right text-muted-foreground uppercase font-bold text-xs tracking-wider">R1</TableHead>
                    <TableHead className="text-right text-muted-foreground uppercase font-bold text-xs tracking-wider">R2</TableHead>
                    <TableHead className="text-right text-muted-foreground uppercase font-bold text-xs tracking-wider hidden md:table-cell">R3</TableHead>
                    <TableHead className="text-right text-muted-foreground uppercase font-bold text-xs tracking-wider hidden md:table-cell">R4</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mode === "live" ? (
                    scoreboard?.leaderboard.map((entry) => (
                      <TableRow 
                        key={entry.poolMemberId} 
                        className="border-border hover:bg-white/5 cursor-pointer transition-colors"
                        onClick={() => scrollToTeam(entry.poolMemberId)}
                      >
                        <TableCell className="text-center font-mono font-bold text-lg">{entry.rank}</TableCell>
                        <TableCell className="font-bold text-lg">{entry.name}</TableCell>
                        <TableCell className={`text-right font-mono font-bold text-lg ${entry.toPar !== null && entry.toPar < 0 ? 'text-primary' : entry.toPar && entry.toPar > 0 ? 'text-muted-foreground' : ''}`}>
                          {formatScore(entry.toPar)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground text-sm font-mono hidden sm:table-cell">{entry.thru}</TableCell>
                        <TableCell className="text-right font-mono text-sm hidden sm:table-cell">{formatScore(entry.today)}</TableCell>
                        <TableCell className="text-right font-mono">{formatScore(entry.r1)}</TableCell>
                        <TableCell className="text-right font-mono">{formatScore(entry.r2)}</TableCell>
                        <TableCell className="text-right font-mono hidden md:table-cell">{formatScore(entry.r3)}</TableCell>
                        <TableCell className="text-right font-mono hidden md:table-cell">{formatScore(entry.r4)}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    manualScoreboard?.leaderboard.map((entry, idx) => (
                      <ManualTableRow 
                        key={entry.poolMemberId} 
                        entry={entry} 
                        rank={idx + 1}
                        onSave={(scores) => activeTournament && handleSaveManualScore(activeTournament.id, entry.poolMemberId, scores)}
                      />
                    ))
                  )}
                </TableBody>
              </Table>
              {mode === "manual" && (
                <div className="p-4 bg-black/20 border-t border-border flex items-center justify-between">
                   <div className="flex items-center gap-2">
                     <span className="text-sm text-muted-foreground">Editor Name:</span>
                     <Input 
                       value={editName}
                       onChange={e => setEditName(e.target.value)}
                       className="w-48 bg-background h-8"
                       placeholder="Your Name"
                     />
                   </div>
                </div>
              )}
            </Card>

            {mode === "live" && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold uppercase tracking-wider text-muted-foreground border-b border-border pb-2">Team Details</h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {scoreboard?.leaderboard.map(entry => {
                    const currentRound = scoreboard.tournament.currentRound || 1;

                    // Aggregate per-golfer data across all rounds
                    const golferMap = new Map<string, {
                      golferId: string;
                      golferName: string;
                      isCut: boolean; isWd: boolean; isDq: boolean;
                      teeTime: string | null;
                      roundScores: (number | null)[];
                      roundCounted: (boolean | null)[];
                      roundIsPenalty: boolean[];
                      holesCompleted: number;
                      totalToPar: number | null;
                    }>();

                    for (const round of entry.rounds) {
                      for (const g of round.golferDetails) {
                        if (!golferMap.has(g.golferId)) {
                          golferMap.set(g.golferId, {
                            golferId: g.golferId,
                            golferName: g.golferName,
                            isCut: false, isWd: false, isDq: false,
                            teeTime: null,
                            roundScores: [null, null, null, null],
                            roundCounted: [null, null, null, null],
                            roundIsPenalty: [false, false, false, false],
                            holesCompleted: 0,
                            totalToPar: null,
                          });
                        }
                        const agg = golferMap.get(g.golferId)!;
                        const idx = round.roundNumber - 1;
                        agg.roundScores[idx] = g.scoreToPar;
                        agg.roundCounted[idx] = g.counted ?? null;
                        agg.roundIsPenalty[idx] = g.isPenalty;
                        if (g.isCut) agg.isCut = true;
                        if (g.isWd) agg.isWd = true;
                        if (g.isDq) agg.isDq = true;
                        if (round.roundNumber === currentRound) {
                          agg.holesCompleted = g.holesCompleted;
                          agg.teeTime = g.teeTime;
                        }
                      }
                    }

                    // Compute total to par for each golfer
                    for (const agg of golferMap.values()) {
                      const scored = agg.roundScores.filter(s => s !== null) as number[];
                      agg.totalToPar = scored.length > 0 ? scored.reduce((a, b) => a + b, 0) : null;
                    }

                    // Sort: best total first, then nulls
                    const golfers = Array.from(golferMap.values()).sort((a, b) => {
                      if (a.totalToPar === null && b.totalToPar === null) return 0;
                      if (a.totalToPar === null) return 1;
                      if (b.totalToPar === null) return -1;
                      return a.totalToPar - b.totalToPar;
                    });

                    // A golfer is "dropped" in a round if counted===false for that round
                    const isDroppedInAnyCountedRound = (agg: typeof golfers[0]) =>
                      agg.roundCounted.every(c => c === false || c === null) && agg.roundCounted.some(c => c === false);

                    return (
                      <Card key={entry.poolMemberId} id={`team-${entry.poolMemberId}`} className="bg-card border-card-border overflow-hidden rounded-xl shadow-lg">
                        <div className="bg-black/40 p-4 border-b border-border flex items-center justify-between">
                          <h3 className="font-bold text-xl">{entry.name}'s Team</h3>
                          <span className={`text-2xl font-mono font-bold ${entry.toPar !== null && entry.toPar < 0 ? 'text-primary' : entry.toPar !== null && entry.toPar > 0 ? 'text-muted-foreground' : ''}`}>
                            {formatScore(entry.toPar)}
                          </span>
                        </div>
                        <div className="p-0 overflow-x-auto">
                          {golfers.length > 0 ? (
                            <Table>
                              <TableHeader className="bg-transparent border-b border-border/50">
                                <TableRow className="border-none hover:bg-transparent">
                                  <TableHead className="text-xs uppercase tracking-wider text-muted-foreground min-w-[140px]">Golfer</TableHead>
                                  <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Total</TableHead>
                                  <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">Thru</TableHead>
                                  <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">R1</TableHead>
                                  <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">R2</TableHead>
                                  <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">R3</TableHead>
                                  <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground">R4</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {golfers.map((golfer) => {
                                  const everCounted = golfer.roundCounted.some(c => c === true);
                                  const neverCounted = golfer.roundCounted.every(c => c === false || c === null) && golfer.roundCounted.some(c => c === false);
                                  const dim = neverCounted && !golfer.isCut && !golfer.isWd && !golfer.isDq;
                                  return (
                                    <TableRow key={golfer.golferId} className={`border-border/20 hover:bg-white/5 ${dim ? 'opacity-40' : ''}`}>
                                      <TableCell className="font-semibold">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className={dim ? 'line-through' : ''}>{golfer.golferName}</span>
                                          {golfer.isCut && <Badge variant="destructive" className="text-[10px] px-1 py-0 h-4">CUT</Badge>}
                                          {golfer.isWd && <Badge variant="destructive" className="text-[10px] px-1 py-0 h-4">WD</Badge>}
                                          {golfer.isDq && <Badge variant="destructive" className="text-[10px] px-1 py-0 h-4">DQ</Badge>}
                                        </div>
                                      </TableCell>
                                      <TableCell className={`text-right font-mono font-bold ${golfer.totalToPar !== null && golfer.totalToPar < 0 ? 'text-primary' : ''}`}>
                                        {formatScore(golfer.totalToPar)}
                                      </TableCell>
                                      <TableCell className="text-right font-mono text-sm text-muted-foreground">
                                        {golfer.isCut || golfer.isWd || golfer.isDq ? '-' : golfer.holesCompleted === 18 ? 'F' : golfer.holesCompleted > 0 ? golfer.holesCompleted : '-'}
                                      </TableCell>
                                      {golfer.roundScores.map((score, i) => (
                                        <TableCell key={i} className={`text-right font-mono text-sm ${score !== null && score < 0 ? 'text-primary' : ''} ${golfer.roundCounted[i] === false ? 'opacity-50 line-through' : ''} ${golfer.roundIsPenalty[i] ? 'italic text-destructive' : ''}`}>
                                          {formatScore(score)}
                                        </TableCell>
                                      ))}
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          ) : (
                            <div className="p-8 text-center text-muted-foreground">No picks entered yet.</div>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}
          </main>
        )}
      </div>
    </div>
  );
}

function ManualTableRow({ entry, rank, onSave }: { entry: any, rank: number, onSave: (scores: any) => void }) {
  const [r1, setR1] = useState<string>(entry.r1?.toString() || "");
  const [r2, setR2] = useState<string>(entry.r2?.toString() || "");
  const [r3, setR3] = useState<string>(entry.r3?.toString() || "");
  const [r4, setR4] = useState<string>(entry.r4?.toString() || "");
  
  const total = [r1, r2, r3, r4].reduce((sum, val) => sum + (parseInt(val) || 0), 0);

  const handleSave = () => {
    onSave({
      r1: r1 ? parseInt(r1) : null,
      r2: r2 ? parseInt(r2) : null,
      r3: r3 ? parseInt(r3) : null,
      r4: r4 ? parseInt(r4) : null,
    });
  };

  return (
    <TableRow className="border-border">
      <TableCell className="text-center font-mono font-bold text-lg">{rank}</TableCell>
      <TableCell>
        <div className="font-bold text-lg">{entry.poolMemberName}</div>
        {entry.updatedBy && (
          <div className="text-xs text-muted-foreground mt-1">Edited by {entry.updatedBy}</div>
        )}
      </TableCell>
      <TableCell className={`text-right font-mono font-bold text-lg ${total < 0 ? 'text-primary' : total > 0 ? 'text-muted-foreground' : ''}`}>
        {formatScore(total)}
      </TableCell>
      <TableCell className="hidden sm:table-cell"></TableCell>
      <TableCell className="hidden sm:table-cell"></TableCell>
      <TableCell className="text-right">
        <Input value={r1} onChange={e => setR1(e.target.value)} className="w-16 ml-auto text-right font-mono h-8" />
      </TableCell>
      <TableCell className="text-right">
        <Input value={r2} onChange={e => setR2(e.target.value)} className="w-16 ml-auto text-right font-mono h-8" />
      </TableCell>
      <TableCell className="text-right hidden md:table-cell">
        <Input value={r3} onChange={e => setR3(e.target.value)} className="w-16 ml-auto text-right font-mono h-8" />
      </TableCell>
      <TableCell className="text-right hidden md:table-cell">
        <Input value={r4} onChange={e => setR4(e.target.value)} className="w-16 ml-auto text-right font-mono h-8" />
      </TableCell>
      <TableCell className="text-right">
        <Button size="sm" onClick={handleSave} className="uppercase font-bold tracking-wider text-xs">Save</Button>
      </TableCell>
    </TableRow>
  );
}
