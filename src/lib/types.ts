export type Rarity = 'Unique' | 'Common' | 'Uncommon'

export interface Power {
  name: string
  text: string
}

export interface Unit {
  id: string
  name: string
  group: string
  set: string
  releaseDate: string
  rarity: Rarity
  type: string // "Hero" | "Squad"
  general: string
  homeworld: string
  species: string
  unitClass: string
  personality: string
  size: string
  height: number
  figures: number
  hexes: number
  life: number
  move: number
  range: number
  attack: number
  defense: number
  powers: Power[]
  cost: {
    normal: number | null
    renegade: number | null
    deltaClassic: number | null
    deltaVc: number | null
  }
  heroscapersUrl: string | null
}

export type Format = 'normal' | 'deltaClassic' | 'deltaVc'

export const FORMAT_LABELS: Record<Format, string> = {
  normal: 'Normal',
  deltaClassic: 'Delta',
  deltaVc: 'Delta (VC customs)',
}

export interface Player {
  id: string
  name: string
}

export interface DraftSettings {
  format: Format
  pointsTotal: number
  groups: string[]
  /** Seconds per pick, or null for no timer. */
  timerSeconds: number | null
  /** Players in first-round pick order. */
  players: Player[]
  collectionId: string
}

export type PickKind = 'pick' | 'pass' | 'timeout'

export interface Pick {
  playerId: string
  kind: PickKind
  unitId: string | null
  /** Global snake slot this pick was made in. */
  slot: number
}

export type DraftStatus = 'drafting' | 'complete'

export interface DraftState {
  settings: DraftSettings
  /** Copies of each unit in the pool at the start of the draft. */
  pool: Record<string, number>
  picks: Pick[]
  /** Players who have passed or can no longer afford anything. */
  donePlayers: string[]
  /** Current global snake slot (round * playerCount + position). */
  slot: number
  status: DraftStatus
  /** When the current turn started (ms since epoch), for the pick timer. */
  turnStartedAt: number
}

/** Settings the host edits in the lobby; player list comes from who joined. */
export interface LobbySettings {
  format: Format
  pointsTotal: number
  groups: string[]
  timerSeconds: number | null
  collectionId: string
  /** User ids in first-round pick order. Joined players missing from it go last. */
  playerOrder: string[]
}

export type DraftAction =
  | { type: 'start' }
  | { type: 'pick'; unitId: string }
  | { type: 'pass' }
  | { type: 'timeout' }
  | { type: 'undo' }
