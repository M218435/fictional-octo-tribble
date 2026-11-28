export class MatchReportGate {
  constructor() {
    this.reset();
  }

  reset() {
    this.room = null;
    this.round = -1;
  }

  claim(room) {
    if (room?.phase !== "over" || typeof room.room !== "string" || !Number.isSafeInteger(room.round))
      return false;
    if (room.room !== this.room) {
      this.room = room.room;
      this.round = -1;
    }
    if (room.round <= this.round) return false;
    this.round = room.round;
    return true;
  }
}
