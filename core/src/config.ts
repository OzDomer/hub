export const MINUTE = 60_000
export const HOUR = 60 * MINUTE

export interface NyxConfig {
    readonly stepMs: number

    readonly hungerPerHour: number
    readonly energyDrainPerHour: number
    readonly energyRecoveryPerHour: number

    readonly sleepBelowEnergy: number
    readonly wakeAboveEnergy: number

    readonly feedHungerRelief: number
    readonly playHappinessGain: number
    readonly playEnergyCost: number
    readonly petHappinessGain: number

    readonly eatDurationMs: number
    readonly playDurationMs: number
    readonly wakeGraceMs: number

    readonly happinessDecayPerHour: number
    readonly happinessRecoveryPerHour: number
    readonly unhappyAboveHunger: number
    readonly unhappyBelowEnergy: number

}

export const defaultConfig: NyxConfig = {
    stepMs: MINUTE,

    hungerPerHour: 5,
    energyDrainPerHour: 6,
    energyRecoveryPerHour: 15,

    sleepBelowEnergy: 20,
    wakeAboveEnergy: 90,

    feedHungerRelief: 30,
    playHappinessGain: 20,
    playEnergyCost: 10,
    petHappinessGain: 5,

    eatDurationMs: 2 * MINUTE,
    playDurationMs: 5 * MINUTE,
    wakeGraceMs: 30 * MINUTE,

    happinessDecayPerHour: 8,
    happinessRecoveryPerHour: 3,
    unhappyAboveHunger: 60,
    unhappyBelowEnergy: 30,
}