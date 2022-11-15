import { clampedMap, computeIfAbsent, DensityFunction, NoiseGeneratorSettings, NoiseParameters, NoiseRouter, NormalNoise, RandomState, XoroshiroRandom } from 'deepslate'
import type { Color } from './colormap'
import { viridis } from './colormap'

export abstract class Sampler<D> {
	private readonly cache = new Map<string, D>()

	protected abstract sample(x: number, y: number): D
	protected abstract color(d: D): Color
	protected abstract text(d: D): string

	private cachedSample(x: number, y: number) {
		return computeIfAbsent(this.cache, `${x} ${y}`, () => {
			return this.sample(x, y)
		})
	}

	public sampleColor(x: number, y: number) {
		return this.color(this.cachedSample(x, y))
	}

	public sampleText(x: number, y: number) {
		return this.text(this.cachedSample(x, y))
	}
}

export class EmptySampler extends Sampler<number> {
	sample() {
		return 0
	}

	color(): Color {
		return [0, 0, 0]
	}

	text() {
		return ''
	}
}

export class NoiseSampler extends Sampler<number> {
	private readonly noise: NormalNoise

	constructor(json: unknown, seed: bigint) {
		super()
		const random = XoroshiroRandom.create(seed)
		const params = NoiseParameters.fromJson(json)
		this.noise = new NormalNoise(random, params)
	}

	sample(x: number, y: number) {
		return this.noise.sample(x, y, 0)
	}

	color(n: number) {
		return viridis(clampedMap(n, -1, 1, 0, 1))
	}

	text(n: number) {
		return n.toPrecision(3)
	} 
}

export class DensityFunctionSampler extends Sampler<number> {
	private readonly fn: DensityFunction

	constructor(json: unknown, seed: bigint) {
		super()
		const settings = NoiseGeneratorSettings.create({
			noise: { minY: 0, height: 256, xzSize: 1, ySize: 1 },
			noiseRouter: NoiseRouter.create({
				finalDensity: DensityFunction.fromJson(json),
			}),
		})
		const state = new RandomState(settings, seed)
		this.fn = state.router.finalDensity
	}

	sample(x: number, y: number) {
		return this.fn.compute({ x, y, z: 0 })
	}

	color(n: number) {
		const clamped = clampedMap(n, -1, 1, 1, 0)
		return viridis(clamped <= 0.5 ? clamped - 0.05 : clamped + 0.05)
	}

	text(n: number) {
		return n.toPrecision(3)
	}
}
