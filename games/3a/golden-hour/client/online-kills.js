// Only ordered server kill events earn credit. Unreliable snapshots are render
// state, and resumed seats can include kills made by the temporary server AI.
export class OnlineKills {
  constructor(account) {
    this.account = account;
    this.reset();
  }
  reset() {
    this.room = null;
    this.round = -1;
    this.count = 0;
    this.recovering = false;
    this.earnedScore = 0;
    this.ending = null;
    this.settled = -1;
  }
  event(event, playerID) {
    // Objective modes may retain cumulative stats across several combat rounds.
    if (Number.isSafeInteger(event.progressRound)) event = { ...event, round: event.progressRound };
    if (event.type === "welcome") {
      if (event.room !== this.room) {
        this.room = event.room;
        this.round = -1;
        this.count = 0;
        this.earnedScore = 0;
        this.settled = -1;
      }
      this.recovering = true;
      this.ending = null;
      return;
    }
    if (event.type === "room" && event.room === this.room && Number.isSafeInteger(event.round)) {
      if (event.round < this.round) return;
      if (event.round > this.round) {
        this.round = event.round;
        this.count = 0;
        this.earnedScore = 0;
      }
      if (this.recovering) {
        this.count = event.players.find(player => player.id === playerID)?.kills || 0;
        this.recovering = false;
      }
      if (this.progression && this.ending?.round === this.round && event.phase === "over" && this.settled !== this.round) {
        const me = event.players.find(player => player.id === playerID);
        if (me) {
          this.settled = this.round;
          const won = this.ending.winner === me.team;
          const award = this.progression.finish(this.earnedScore, won);
          this.account.flush();
          return { room: event.room, round: this.round, score: this.earnedScore, won, award };
        }
      }
      return;
    }
    if (event.type === "round-start" && Number.isSafeInteger(event.round) && event.round > this.round) {
      this.round = event.round;
      this.count = 0;
      this.earnedScore = 0;
      this.ending = null;
      return;
    }
    if (event.round !== this.round || this.recovering) return;
    if (event.type === "kill" && event.killer === playerID && Number.isSafeInteger(event.kills) && event.kills > this.count) {
      const delta = event.kills - this.count;
      this.count = event.kills;
      // Current authoritative PvP awards 100 score per confirmed kill. Keep
      // resume/AI baselines out of XP as well as out of the kill leaderboard.
      this.earnedScore += delta * 100;
      this.account.record("online", delta);
      const challenge = ["ar", "smg", "shotgun", "pistol", "m200", "rpk"].includes(event.weapon) &&
        typeof event.ads === "boolean" && Number.isFinite(event.range)
        ? { ads: event.ads, hipfire: !event.ads, longshot: event.range >= 35, multikill: event.multikill === true }
        : null;
      this.progression?.kill(event.weapon, event.head, delta, challenge);
    }
    if (event.type === "round-end") {
      this.ending = event;
      if (!this.progression) this.account.flush();
    }
  }
}
