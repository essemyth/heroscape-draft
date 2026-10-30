// Tags what a power does for the units it affects, from its name and text:
// "Atk boost", "Def boost", "Bonding", "Healing", ... Used by build-synergies.mjs.
// Powers that fit none of these are shown as "Support".

const UP = String.raw`(?:add|adds|increases?|receives?|gains?|rolls?|gets?)`
const GIVE = String.raw`(?:add|adds|receives?|gains?|gets?|rolls?)`
const N = String.raw`(?:\d+|one|two|three|an?)`

// A real bonus: "an additional attack die", "add 1 die to the Defense of", "an automatic shield".
// Plain "rolls defense dice against a normal attack" is not a bonus.
const atkBoost = new RegExp(
  [
    String.raw`\b${N}\s+(?:additional|extra|automatic)\s+(?:attack dic?e|skulls?)`,
    String.raw`\b${GIVE}\s+${N}\s+attack dic?e`,
    String.raw`\badds? ${N} (?:automatic )?skulls?`,
    String.raw`\badds? ${N} (?:die |dice )?to [^.]{0,25}\battack\b`,
    String.raw`\bincreases? (?:its|their|his|her) attack value`,
    String.raw`dic?e when attacking`,
    String.raw`attack (?:one )?additional time`,
    String.raw`may attack again`,
    String.raw`counts? for an additional skull`,
  ].join('|'),
  'i',
)

const defBoost = new RegExp(
  [
    String.raw`\b${N}\s+(?:additional|extra|automatic)\s+(?:defen[cs]e dic?e|shields?)`,
    String.raw`\b${GIVE}\s+${N}\s+defen[cs]e dic?e`,
    String.raw`\badds? ${N} (?:automatic )?shields?`,
    String.raw`\badds? ${N} (?:die |dice )?to [^.]{0,25}\bdefen[cs]e\b`,
    String.raw`\bincreases? (?:its|their|his|her) defen[cs]e value`,
    String.raw`counts? as (?:an? )?(?:additional )?shields?`,
  ].join('|'),
  'i',
)

const RULES = [
  // [tag, test on the power's name, test on its text]
  ['Bonding', /bonding/i, /take (?:a |their )?turns? with (?!this unit)|instead of (?:taking|attacking)[^.]*take a turn with (?!this unit)/i],
  ['Atk boost', null, atkBoost],
  ['Def boost', null, defBoost],
  ['Move boost', null, new RegExp(String.raw`\b${UP}\b[^.]{0,30}\bmove\b|move (?:\d+|one|two|three) additional spaces?`, 'i')],
  ['Range boost', null, new RegExp(String.raw`\b${UP}\b[^.]{0,30}\brange\b`, 'i')],
  ['Healing', null, /\bremove (?:one|a|an|two|\d+|all|up to \d+) wound/i],
  ['Wound save', /defy death/i, /\bignore (?:any|all|those|the|that)?\s*wounds?|\bis not destroyed|instead of removing|before removing that figure/i],
  ['Revive', /rebirth|reinforce|summon|necromancy|resurrect|risen/i, /previously destroyed|(?:one|any) of your destroyed|destroyed[^.]*\bplace\b[^.]*\b(?:empty|unoccupied) space/i],
  ['Life boost', null, /\badd (?:\d+|one|two) to (?:their|its) life|\bgains? (?:\d+|one) life/i],
  ['Die roll +', null, /\badd (?:\d+|one|two) to (?:your|the) (?:die |d20 |20-sided die )?rolls?|\badd \d+ to your roll/i],
  ['Reposition', /carry|skyhook|phase|shift|hunting party/i, /\b(?:you may|may)(?: immediately)? (?:move|place|switch)\b[^.]*\b(?:spaces?|adjacent)|\bswitch [^.]* and the chosen figure|\bmove up to \d+ [^.]*\bspaces/i],
  ['Enemy Def −', null, /\breduce (?:their|its) defen[cs]e|(?:less|fewer) defen[cs]e di|su[bt]*ract[s]? (?:one|1|\d+) from (?:their|its) defen[cs]e|subtracts? 1 from/i],
  ['Retaliation', /retribution|evil eye|counter/i, /count as (?:unblockable )?hits on the attacking figure|inflicted by [^.]* on the attacking figure/i],
  ['Order markers', /initiative|lion of|now you know|fearsome stalker/i, /\b(?:move|look at|reveal)\b[^.]*\border markers?/i],
  ['Spirit', /spirit/i, /when [^.]* is destroyed, place this figure on/i],
  ['Mobility', null, /move through all figures|never (?:attacked|take leaving engagement)|do not take leaving engagement/i],
  ['Class link', null, /gains? the class|class is also|class of \w+ in addition/i],
]

function withoutOwnName(power, ownName) {
  let text = power.text
  for (const n of new Set([ownName, ownName.split(/[\s,]+/)[0]])) {
    if (n.length >= 3) text = text.split(n).join('this unit')
  }
  return text
}

/**
 * True when the bonus goes to the unit itself and the other units it names are what power it:
 * "Add 1 to Sir Dupuis' attack dice for every Knight you control", "A Thunderhoof Cavalry figure
 * increases its Attack Value by the number of friendly Dwarf Heroes". Those links point the other way.
 */
export function benefitsSelf(power, ownName = '') {
  const text = withoutOwnName(power, ownName)
  // Only wordings where the unit itself is the one getting the bonus.
  const SELF = [
    /\badd \d+ to this unit'?s? (?:attack|defen[cs]e|move)/i, // Sir Dupuis, Chardris
    /\bthis unit(?: figure)? increases its (?:attack|defen[cs]e|move) value by the number of/i, // Thunderhoof Cavalry
    /\bthis unit(?: figure)? rolls (?:an?|\d+|one) additional (?:attack|defen[cs]e) dic?e for (?:each|every)/i, // Tombstone Gunslinger
    /\bthis unit may add \d+ to (?:his|her|its) (?:move|attack|defen[cs]e)/i, // Sir Orrick
    /\bwhen rolling defen[cs]e dice for this unit, if this unit is adjacent/i, // Hatamoto Taro
    /\bin (?:the )?this unit receives \d+ additional/i, // 4th Massachusetts Line, Sacred Band
    // "If Otonashi starts her turn adjacent to ... tricky ..., she may move 4 additional spaces."
    /\bif this unit\b[^.]*,\s*(?:she|he|it) (?:may )?(?:move|moves|add|adds|roll|rolls|receive|receives)\b[^.]*\badditional\b/i,
  ]
  return SELF.some((re) => re.test(text))
}

/** `ownName` is the unit's name without version, e.g. "Sir Gilbert": its own turns aren't bonding. */
export function effectsOf(power, ownName = '') {
  const text = withoutOwnName(power, ownName)
  // "may move 2 additional spaces" is a Move boost, not moving another figure.
  const withoutExtraMove = text.replace(/\bmay move (?:\d+|one|two|three|four) additional spaces?\b/gi, '')
  const tags = []
  for (const [tag, nameTest, textTest] of RULES) {
    const t = tag === 'Reposition' ? withoutExtraMove : text
    if ((nameTest && nameTest.test(power.name)) || (textTest && textTest.test(t))) tags.push(tag)
  }
  // Bonding and Revive already cover moving or placing the other unit.
  const result = tags.includes('Bonding') || tags.includes('Revive') ? tags.filter((t) => t !== 'Reposition') : tags
  // "excess shields count as hits on the attacker" is retaliation, not extra defense.
  const final = result.includes('Retaliation') ? result.filter((t) => t !== 'Def boost') : result
  return final.length ? final : ['Support']
}
