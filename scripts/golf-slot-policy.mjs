export function compareLineGroups(left, right, options = {}) {
  const respectWindow = options.respectWindow !== false;
  if (respectWindow) {
    return left.minutes - right.minutes
      || Number(right.score || 0) - Number(left.score || 0)
      || left.y - right.y;
  }

  const windowEndMinutes = Number(options.windowEndMinutes);
  const leftDistance = Math.abs(left.minutes - windowEndMinutes);
  const rightDistance = Math.abs(right.minutes - windowEndMinutes);
  return leftDistance - rightDistance
    || right.minutes - left.minutes
    || Number(right.score || 0) - Number(left.score || 0)
    || left.y - right.y;
}

export function allowsSingleSlotFallback(players) {
  return Number(players) <= 1;
}
