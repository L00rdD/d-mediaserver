// Cerebro's scene engine, built from 74cad35 by home/cerebro/build.sh: do not edit.
var CerebroScene = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region ../cerebro/ui/src/lib/scene/pixels.ts
	/** Filled disc made of 1px rows. */
	function pixelDisc(ctx, cx, cy, radius, color) {
		ctx.fillStyle = color;
		for (let dy = -radius; dy <= radius; dy++) {
			const half = Math.round(Math.sqrt(radius * radius - dy * dy));
			ctx.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
		}
	}
	/** Circle outline; `squash` < 1 flattens it into an ellipse seen from above. */
	function pixelRing(ctx, cx, cy, radius, color, squash = 1) {
		ctx.fillStyle = color;
		const steps = Math.max(8, Math.round(Math.PI * 2 * radius));
		for (let i = 0; i < steps; i++) {
			const angle = i / steps * Math.PI * 2;
			ctx.fillRect(Math.round(cx + Math.cos(angle) * radius), Math.round(cy + Math.sin(angle) * radius * squash), 1, 1);
		}
	}
	/** Straight line, one pixel per step along its longest axis. */
	function pixelLine(ctx, x0, y0, x1, y1, color) {
		ctx.fillStyle = color;
		const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
		for (let i = 0; i <= steps; i++) {
			const t = i / steps;
			ctx.fillRect(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 1, 1);
		}
	}
	//#endregion
	//#region ../cerebro/ui/src/lib/scene/wander.ts
	/** Walk cycle: step, pass, other step, pass. */
	const WALK_CYCLE = [
		1,
		2,
		3,
		2
	];
	/** 32-bit FNV-1a with a murmur3 finalizer. */
	function hash32(text) {
		let h = 2166136261;
		for (let i = 0; i < text.length; i++) {
			h ^= text.charCodeAt(i);
			h = Math.imul(h, 16777619);
		}
		h ^= h >>> 16;
		h = Math.imul(h, 2246822507);
		h ^= h >>> 13;
		h = Math.imul(h, 3266489909);
		h ^= h >>> 16;
		return h >>> 0;
	}
	/** Number in [0, 1) derived from (seed, n). */
	function unit(seed, n) {
		let t = seed + Math.imul(n, 2654435769) >>> 0;
		t = Math.imul(t ^ t >>> 15, t | 1);
		t ^= t + Math.imul(t ^ t >>> 7, t | 61);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	}
	/**
	* Per movement: `pace` scales the leg duration, `share` is the part of each leg spent
	* moving; the rest is a pause at the waypoint, where the character may use a power.
	*/
	const MOVEMENTS = {
		walk: {
			pace: 1,
			share: .6
		},
		phase: {
			pace: 1,
			share: .6
		},
		fly: {
			pace: 1.1,
			share: .55
		},
		teleport: {
			pace: 1,
			share: .3
		},
		dash: {
			pace: .8,
			share: .2
		}
	};
	/** Share of pauses where the character uses its power. */
	const CAST_CHANCE = .75;
	/** Hovering height of flyers, with a slow bob. */
	function hover(seed, seconds) {
		return 8 + Math.round(Math.sin(seconds * 3 + seed % 7) * 2);
	}
	function poseAt(actorId, area, seconds, walking, movement = "walk") {
		const seed = hash32(actorId);
		const point = (k) => ({
			x: area.x + unit(seed, k * 2) * area.width,
			y: area.y + unit(seed, k * 2 + 1) * area.height
		});
		if (!walking) {
			const home = point(0);
			return {
				x: Math.floor(home.x),
				y: Math.floor(home.y),
				facing: "front",
				flip: false,
				frame: 0,
				lift: 0,
				alpha: 1
			};
		}
		const { pace, share } = MOVEMENTS[movement];
		const clock = seconds / ((3 + unit(seed, 999) * 2.5) * pace) + unit(seed, 998) * 100;
		const k = Math.floor(clock);
		const progress = clock - k;
		const from = point(k);
		const to = point(k + 1);
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		const flying = movement === "fly";
		if (progress >= share) return {
			x: Math.floor(to.x),
			y: Math.floor(to.y),
			facing: "front",
			flip: dx < 0,
			frame: 0,
			lift: flying ? hover(seed, seconds) : 0,
			alpha: 1,
			cast: unit(seed, 5e3 + k) < CAST_CHANCE ? {
				leg: k,
				progress: (progress - share) / (1 - share)
			} : void 0
		};
		const u = progress / share;
		const travel = {
			from,
			to,
			progress: u
		};
		if (movement === "teleport") {
			const at = u < .5 ? from : to;
			const alpha = u < .3 ? 1 - u / .3 : u > .7 ? (u - .7) / .3 : 0;
			return {
				x: Math.floor(at.x),
				y: Math.floor(at.y),
				facing: "front",
				flip: dx < 0,
				frame: 0,
				lift: 0,
				alpha,
				travel
			};
		}
		const stepsPerSecond = movement === "dash" ? 16 : 8;
		const vertical = Math.abs(dy) * 2 > Math.abs(dx);
		return {
			x: Math.floor(from.x + dx * u),
			y: Math.floor(from.y + dy * u),
			facing: vertical ? dy < 0 ? "back" : "front" : "side",
			flip: dx < 0,
			frame: flying ? 0 : WALK_CYCLE[Math.floor(seconds * stepsPerSecond) % WALK_CYCLE.length],
			lift: flying ? hover(seed, seconds) + 3 : 0,
			alpha: movement === "phase" ? .45 : 1,
			travel
		};
	}
	//#endregion
	//#region ../cerebro/ui/src/lib/scene/powers.ts
	/** Powers aimed in front of the caster, used side-on. */
	const AIMED = /* @__PURE__ */ new Set([
		"beam",
		"claws",
		"throw",
		"sonic"
	]);
	/** The effect plays in the middle of the pause, leaving a breath before and after. */
	function effectProgress(cast) {
		if (cast < .1 || cast >= .9) return void 0;
		return (cast - .1) / .8;
	}
	/** How a power moves its caster: leaps lift it, quakes shake it. */
	function castOffset(kind, pose, seconds) {
		const e = pose.cast && effectProgress(pose.cast.progress);
		if (e === void 0) return {
			dx: 0,
			lift: 0
		};
		if (kind === "leap") return {
			dx: 0,
			lift: Math.round(Math.sin(Math.PI * e) * 18)
		};
		if (kind === "quake") return {
			dx: Math.floor(seconds * 20) % 2,
			lift: 0
		};
		return {
			dx: 0,
			lift: 0
		};
	}
	function drawPower(kind, p) {
		const e = p.pose.cast && effectProgress(p.pose.cast.progress);
		if (e === void 0) return;
		const { ctx } = p;
		ctx.save();
		ctx.globalAlpha = Math.min(1, e * 6, (1 - e) * 6);
		DRAWERS[kind](p, e);
		ctx.restore();
	}
	const DRAWERS = {
		beam,
		bolt,
		psychic,
		fire,
		frost,
		claws,
		throw: projectile,
		sparks,
		shield,
		magnet,
		sonic,
		quake,
		clone,
		leap,
		absorb,
		glow
	};
	/** Anchor points on a 24px sprite drawn at `scale`: `head` is at eye level. */
	function body(p) {
		const feet = p.pose.y - p.lift;
		return {
			dir: p.pose.flip ? -1 : 1,
			feet,
			chest: feet - Math.round(9 * p.scale),
			head: feet - Math.round(16 * p.scale)
		};
	}
	/** Distance from x to the wall in direction dir. */
	function toWall(p, x, dir) {
		return dir > 0 ? p.width - 1 - x : x;
	}
	function burst(ctx, cx, cy, radius, color) {
		ctx.fillStyle = color;
		const rays = Math.max(8, Math.round(radius * 2));
		for (let i = 0; i < rays; i++) {
			const angle = i / rays * Math.PI * 2;
			ctx.fillRect(Math.round(cx + Math.cos(angle) * radius), Math.round(cy + Math.sin(angle) * radius), 1, 1);
		}
	}
	/** Optic blast or plasma: a beam from the eyes to the wall. */
	function beam(p, e) {
		const { ctx } = p;
		const { dir, head } = body(p);
		const x0 = p.x + dir * Math.round(5 * p.scale);
		const y = head;
		const length = Math.round(Math.min(1, e * 4) * toWall(p, x0, dir));
		const x1 = x0 + dir * length;
		ctx.fillStyle = p.color;
		ctx.fillRect(Math.min(x0, x1), y - 1, length + 1, 3);
		ctx.fillStyle = "#FFFFFF";
		ctx.fillRect(Math.min(x0, x1), y - Math.floor(p.seconds * 10) % 2, length + 1, 1);
		if (e > .25) burst(ctx, x1, y, 2 + Math.floor(p.seconds * 10) % 4, p.color);
	}
	/** Lightning: zigzag strikes from the top of the room next to the caster. */
	function bolt(p, e) {
		const { ctx } = p;
		const { dir, head } = body(p);
		ctx.fillStyle = p.color;
		ctx.fillRect(p.x - 3, head, 2, 2);
		ctx.fillRect(p.x + 1, head, 2, 2);
		const strike = Math.floor(e * 3);
		if (e * 3 - strike > .6) return;
		const n = p.pose.cast.leg * 7 + strike;
		const target = Math.round(Math.max(4, Math.min(p.width - 5, p.x + dir * (12 + unit(p.seed, n) * 28))));
		const ground = p.pose.y;
		let x = target + Math.round((unit(p.seed, n + 100) - .5) * 20);
		for (let y = 0; y < ground; y += 6) {
			const next = y + 6 >= ground ? target : x + Math.round((unit(p.seed, n * 31 + y) - .5) * 10);
			pixelLine(ctx, x, y, next, Math.min(y + 6, ground), p.color);
			pixelLine(ctx, x + 1, y, next + 1, Math.min(y + 6, ground), "#FFFFFF");
			x = next;
		}
		burst(ctx, target, ground, 3, "#FFFFFF");
		burst(ctx, target, ground, 5, p.color);
		ctx.globalAlpha *= .12;
		ctx.fillStyle = "#FFFFFF";
		ctx.fillRect(0, 0, p.width, p.height);
	}
	/** Telepathy: rings spreading from the head. */
	function psychic(p, e) {
		const { ctx } = p;
		const { head } = body(p);
		const alpha = ctx.globalAlpha;
		for (let i = 0; i < 3; i++) {
			const r = (e * 2.5 + i / 3) % 1 * 20;
			ctx.globalAlpha = alpha * (1 - r / 20);
			pixelRing(ctx, p.x, head - 2, Math.max(3, Math.round(r)), p.color, .7);
		}
		ctx.globalAlpha = alpha;
		ctx.fillStyle = p.color;
		ctx.fillRect(p.x - 1, head - 4, 2, 2);
	}
	/** Flames rising around the body. */
	function fire(p, e) {
		const { ctx } = p;
		const { feet } = body(p);
		const alpha = ctx.globalAlpha;
		for (let i = 0; i < 24; i++) {
			const life = (e * 4 + unit(p.seed, i)) % 1;
			const x = Math.round(p.x + (unit(p.seed, i + 50) - .5) * 20 + Math.sin(life * 6 + i) * 2);
			const y = Math.round(feet - life * 28);
			ctx.globalAlpha = alpha * (1 - life);
			ctx.fillStyle = life < .3 ? "#FFE27A" : p.color;
			const size = life < .3 ? 3 : life < .6 ? 2 : 1;
			ctx.fillRect(x, y, size, size);
		}
	}
	/** Ice crystals spreading on the floor and a few snowflakes. */
	function frost(p, e) {
		const { ctx } = p;
		const ground = p.pose.y;
		const spread = Math.min(1, e * 2) * 22;
		for (let i = 0; i < 10; i++) {
			const angle = i / 10 * Math.PI * 2 + unit(p.seed, i) * .4;
			const cx = Math.round(p.x + Math.cos(angle) * spread);
			const cy = Math.round(ground + Math.sin(angle) * spread * .35);
			ctx.fillStyle = p.color;
			ctx.fillRect(cx - 2, cy, 5, 1);
			ctx.fillRect(cx, cy - 2, 1, 5);
			ctx.fillStyle = "#FFFFFF";
			ctx.fillRect(cx, cy, 1, 1);
		}
		ctx.fillStyle = "#FFFFFF";
		for (let i = 0; i < 10; i++) {
			const fall = (e * 2 + unit(p.seed, i + 30)) % 1;
			ctx.fillRect(Math.round(p.x + (unit(p.seed, i + 30) - .5) * 36), Math.round(ground - 32 + fall * 32), 1, 1);
		}
	}
	/** Three slashes in front of the caster, twice. */
	function claws(p, e) {
		const { ctx } = p;
		const { dir, chest } = body(p);
		const swipe = e * 2 % 1;
		const reach = Math.round(Math.min(1, swipe * 3) * 11);
		const alpha = ctx.globalAlpha;
		ctx.globalAlpha = alpha * (1 - swipe);
		for (let i = 0; i < 3; i++) {
			const x0 = p.x + dir * (Math.round(6 * p.scale) + i * 3);
			const y0 = chest - 7;
			pixelLine(ctx, x0, y0, x0 + dir * reach, y0 + reach, p.color);
			pixelLine(ctx, x0 + dir, y0, x0 + dir * (reach + 1), y0 + reach, "#FFFFFF");
		}
		ctx.globalAlpha = alpha;
	}
	/** A glowing projectile thrown forward, exploding at the end of its flight. */
	function projectile(p, e) {
		const { ctx } = p;
		const { dir, chest } = body(p);
		const x0 = p.x + dir * Math.round(7 * p.scale);
		const range = Math.min(64, toWall(p, x0, dir));
		const flight = Math.min(1, e / .55);
		const x = Math.round(x0 + dir * range * flight);
		const y = Math.round(chest - Math.sin(Math.PI * flight) * 8);
		if (e < .55) {
			ctx.fillStyle = p.color;
			ctx.fillRect(x - 1, y - 1, 3, 3);
			ctx.fillStyle = "#FFFFFF";
			ctx.fillRect(x, y, 1, 1);
			ctx.fillRect(x - dir * 3, y, 1, 1);
			ctx.fillRect(x - dir * 5, y, 1, 1);
		} else {
			const blast = (e - .55) / .45;
			burst(ctx, x, y, 2 + Math.round(blast * 9), p.color);
			burst(ctx, x, y, 1 + Math.round(blast * 5), "#FFFFFF");
		}
	}
	/** Fireworks bursting above the caster. */
	function sparks(p, e) {
		const { ctx } = p;
		const { head } = body(p);
		const leg = p.pose.cast.leg;
		for (let b = 0; b < 3; b++) {
			const local = e * 1.6 - b * .3;
			if (local < 0 || local >= 1) continue;
			const cx = Math.round(p.x + (unit(p.seed, leg * 3 + b) - .5) * 32);
			const cy = Math.round(head - 8 - unit(p.seed, leg * 3 + b + 40) * 14);
			burst(ctx, cx, cy, 2 + Math.round(local * 8), b % 2 === 0 ? p.color : "#FFFFFF");
			burst(ctx, cx, cy, 1 + Math.round(local * 4), b % 2 === 0 ? "#FFFFFF" : p.color);
		}
	}
	/** A force field around the body. */
	function shield(p, e) {
		const { ctx } = p;
		const { chest } = body(p);
		const radius = Math.round(Math.min(1, e * 5) * 12 * p.scale);
		const alpha = ctx.globalAlpha;
		ctx.globalAlpha = alpha * .25;
		pixelDisc(ctx, p.x, chest, radius, p.color);
		ctx.globalAlpha = alpha * (.7 + .3 * Math.sin(p.seconds * 8));
		pixelRing(ctx, p.x, chest, radius, p.color);
		ctx.globalAlpha = alpha;
	}
	/** Debris orbiting the caster, held by a magnetic or telekinetic field. */
	function magnet(p, e) {
		const { ctx } = p;
		const { chest } = body(p);
		const radius = 8 + Math.min(1, e * 4) * 10;
		pixelRing(ctx, p.x, chest, Math.round(radius), p.color, .4);
		for (let i = 0; i < 4; i++) {
			const angle = p.seconds * 4 + i / 4 * Math.PI * 2;
			const x = Math.round(p.x + Math.cos(angle) * radius);
			const y = Math.round(chest + Math.sin(angle) * radius * .4 - 5);
			ctx.fillStyle = "#9AA0A6";
			ctx.fillRect(x, y, 2, 2);
			ctx.fillStyle = p.color;
			ctx.fillRect(x, y, 1, 1);
		}
	}
	/** Sonic scream: arcs travelling forward. */
	function sonic(p, e) {
		const { ctx } = p;
		const { dir, head } = body(p);
		const alpha = ctx.globalAlpha;
		const range = Math.min(44, toWall(p, p.x, dir));
		for (let i = 0; i < 3; i++) {
			const d = (e * 2 + i / 3) % 1 * range;
			const half = 2 + Math.round(d / 5);
			ctx.globalAlpha = alpha * (1 - d / Math.max(range, 1));
			ctx.fillStyle = p.color;
			for (let dy = -half; dy <= half; dy++) {
				const bend = Math.round(dy * dy / (half * 1.5));
				ctx.fillRect(Math.round(p.x + dir * (7 * p.scale + d - bend)), head + 4 + dy, 1, 1);
			}
		}
		ctx.globalAlpha = alpha;
	}
	/** Cracks running along the floor, with dust. */
	function quake(p, e) {
		const { ctx } = p;
		const ground = p.pose.y + 1;
		const length = Math.round(Math.min(1, e * 3) * 26);
		for (const dir of [-1, 1]) {
			let y = ground;
			for (let s = 0; s < length; s++) {
				if (unit(p.seed, s * 2 + (dir > 0 ? 1 : 0)) < .3) y += unit(p.seed, s + 77) < .5 ? -1 : 1;
				ctx.fillStyle = "#A89878";
				ctx.fillRect(p.x + dir * (5 + s), y, 1, 1);
			}
		}
		ctx.fillStyle = "#C8B89A";
		for (let i = 0; i < 10; i++) {
			const hop = (e * 3 + unit(p.seed, i)) % 1;
			const x = Math.round(p.x + (unit(p.seed, i + 10) - .5) * 30);
			ctx.fillRect(x, Math.round(ground - Math.sin(Math.PI * hop) * 8), 2, 2);
		}
	}
	/** Duplicates popping up around the caster. */
	function clone(p, e) {
		const spots = [
			-20,
			20,
			-11,
			11
		].map((dx) => Math.round(dx * p.scale));
		const shown = Math.min(spots.length, Math.floor(e * 6) + 1);
		for (let i = 0; i < shown; i++) {
			const x = Math.round(Math.max(12, Math.min(p.width - 12, p.x + spots[i])));
			const y = p.pose.y + (i < 2 ? 0 : -7);
			p.ghost(x, y, .85);
			if (e > .85) burst(p.ctx, x, y - Math.round(10 * p.scale), Math.round((e - .85) * 60), "#FFFFFF");
		}
	}
	/** Dust at take-off and landing; the jump itself is `castOffset`. */
	function leap(p, e) {
		const ground = p.pose.y;
		if (e < .2) burst(p.ctx, p.x, ground, 3 + Math.round(e * 30), "#C8B89A");
		else if (e > .8) burst(p.ctx, p.x, ground, 3 + Math.round((e - .8) * 30), "#C8B89A");
	}
	/** Energy pulled in towards the caster. */
	function absorb(p, e) {
		const { ctx } = p;
		const { chest } = body(p);
		const pull = e * 2 % 1;
		const radius = (1 - pull) * 24;
		ctx.fillStyle = p.color;
		for (let i = 0; i < 12; i++) {
			const angle = i / 12 * Math.PI * 2 + e * 3;
			ctx.fillRect(Math.round(p.x + Math.cos(angle) * radius), Math.round(chest + Math.sin(angle) * radius * .7), 1, 1);
		}
		if (pull > .8) pixelRing(ctx, p.x, chest, 4, "#FFFFFF");
	}
	/** A pulse of light from the body, for everyone else. */
	function glow(p, e) {
		const { ctx } = p;
		const { chest } = body(p);
		const alpha = ctx.globalAlpha;
		ctx.globalAlpha = alpha * (.3 + .2 * Math.sin(p.seconds * 6));
		pixelDisc(ctx, p.x, chest - 2, 9 + Math.round(Math.sin(Math.PI * e) * 5), p.color);
		ctx.globalAlpha = alpha;
		const leg = p.pose.cast.leg;
		ctx.fillStyle = "#FFFFFF";
		for (let i = 0; i < 6; i++) {
			const twinkle = (e * 3 + unit(p.seed, leg + i)) % 1;
			if (twinkle > .5) continue;
			const tx = Math.round(p.x + (unit(p.seed, leg * 5 + i) - .5) * 28);
			const ty = Math.round(chest - 12 + unit(p.seed, i + 60) * 18);
			ctx.fillRect(tx, ty, 1, 1);
			if (twinkle < .2) {
				ctx.fillRect(tx - 1, ty, 3, 1);
				ctx.fillRect(tx, ty - 1, 1, 3);
			}
		}
	}
	//#endregion
	//#region ../cerebro/ui/src/lib/scene/renderer.ts
	const EMOTE_SIZE = 9;
	/**
	* Characters are drawn larger than the rooms' scale so they read at a glance. 1.5 keeps them
	* crisp on Retina: each sprite pixel covers exactly 3 device pixels.
	*/
	const CHARACTER_SCALE = 1.5;
	function drawScene(ctx, catalog, room, actors, seconds) {
		const { width, height } = catalog.roomSize;
		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, width, height);
		const frame = room.frames > 1 ? Math.floor(seconds * room.fps) % room.frames : 0;
		ctx.drawImage(room.image, frame * width, 0, width, height, 0, 0, width, height);
		actors.flatMap((actor) => {
			const asset = catalog.characters.get(actor.character);
			if (!asset) return [];
			return [{
				actor,
				asset,
				pose: poseAt(actor.id, room.walkArea, seconds, actor.state === "walking", asset.move)
			}];
		}).sort((a, b) => a.pose.y - b.pose.y).forEach(({ actor, asset, pose }) => drawActor(ctx, catalog, actor, asset, pose, seconds));
	}
	function drawActor(ctx, catalog, actor, asset, pose, seconds) {
		const size = {
			width: catalog.characterSize.width * CHARACTER_SCALE,
			height: catalog.characterSize.height * CHARACTER_SCALE
		};
		if (pose.cast && AIMED.has(asset.power)) pose = {
			...pose,
			facing: "side"
		};
		const offset = castOffset(asset.power, pose, seconds);
		const x = pose.x + offset.dx;
		const lift = pose.lift + offset.lift;
		const top = pose.y - lift - size.height + 1;
		const sprite = (feetX, feetY, alpha) => drawSprite(ctx, asset, size, pose, feetX, feetY, alpha);
		ctx.globalAlpha = pose.alpha;
		ctx.fillStyle = "rgba(20, 12, 30, 0.28)";
		const shadow = lift > 0 ? 12 : 18;
		ctx.fillRect(x - shadow / 2, pose.y, shadow, 2);
		ctx.fillRect(x - shadow / 2 + 2, pose.y + 2, shadow - 4, 1);
		if (asset.aura) {
			ctx.globalAlpha = pose.alpha * (.18 + .08 * Math.sin(seconds * 3 + pose.x));
			pixelDisc(ctx, x, pose.y - lift - 15, 16, asset.aura);
		}
		ctx.globalAlpha = 1;
		if (pose.travel && asset.move === "dash") drawAfterimages(pose, sprite);
		sprite(x, pose.y - lift, pose.alpha * (actor.state === "asleep" ? .75 : 1));
		if (pose.travel && asset.move === "teleport") drawTeleportSmoke(ctx, pose, asset.powerColor);
		drawPower(asset.power, {
			ctx,
			pose,
			x,
			lift,
			seed: hash32(actor.id),
			seconds,
			scale: CHARACTER_SCALE,
			color: asset.powerColor,
			width: catalog.roomSize.width,
			height: catalog.roomSize.height,
			ghost: (gx, gy, alpha) => sprite(gx, gy, alpha)
		});
		if (actor.state === "asleep") {
			const rise = Math.floor(seconds * 2) % 4;
			ctx.globalAlpha = 1 - rise * .2;
			drawEmote(ctx, catalog, 0, x + 3, top - 2 - rise);
			ctx.globalAlpha = 1;
		} else if (actor.state === "alert" && Math.floor(seconds * 3) % 2 === 0) drawEmote(ctx, catalog, 1, x - Math.floor(EMOTE_SIZE / 2), top - EMOTE_SIZE);
	}
	/** Sheet rows, top to bottom. */
	const ROWS = {
		front: 0,
		back: 1,
		side: 2
	};
	/** Draws the character's current frame with its feet at (x, y); `size` is the drawn size. */
	function drawSprite(ctx, asset, size, pose, x, y, alpha) {
		if (alpha <= 0) return;
		const { width, height } = size;
		const frameWidth = width / CHARACTER_SCALE;
		const frameHeight = height / CHARACTER_SCALE;
		const left = Math.round(x - width / 2);
		const top = Math.round(y - height + 1);
		const sx = pose.frame * frameWidth;
		const sy = ROWS[pose.facing] * frameHeight;
		ctx.save();
		ctx.globalAlpha = alpha;
		if (pose.flip && pose.facing === "side") {
			ctx.translate(left + width, top);
			ctx.scale(-1, 1);
			ctx.drawImage(asset.image, sx, sy, frameWidth, frameHeight, 0, 0, width, height);
		} else ctx.drawImage(asset.image, sx, sy, frameWidth, frameHeight, left, top, width, height);
		ctx.restore();
	}
	/** Super speed: fading copies left behind along the path. */
	function drawAfterimages(pose, sprite) {
		const { from, to, progress } = pose.travel;
		for (let i = 3; i >= 1; i--) {
			const u = progress - i * .08;
			if (u <= 0) continue;
			sprite(Math.floor(from.x + (to.x - from.x) * u), Math.floor(from.y + (to.y - from.y) * u), .4 / i);
		}
	}
	/** Teleport: a puff of smoke where the character leaves, then where it lands. */
	function drawTeleportSmoke(ctx, pose, color) {
		const { from, to, progress } = pose.travel;
		const at = progress < .5 ? from : to;
		const t = progress < .5 ? progress / .5 : (progress - .5) / .5;
		const spread = progress < .5 ? t : 1 - t;
		const cx = Math.floor(at.x);
		const cy = Math.floor(at.y) - 10;
		ctx.save();
		ctx.globalAlpha = .9 * (progress < .5 ? 1 - t * .6 : .4 + (1 - t) * .6);
		for (let i = 0; i < 14; i++) {
			const angle = i / 14 * Math.PI * 2 + spread;
			const r = 3 + spread * 11;
			ctx.fillStyle = i % 3 === 0 ? "#FFFFFF" : color;
			ctx.fillRect(Math.round(cx + Math.cos(angle) * r), Math.round(cy + Math.sin(angle) * r * .8), 2, 2);
		}
		ctx.restore();
	}
	function drawEmote(ctx, catalog, index, x, y) {
		ctx.drawImage(catalog.emotes, index * EMOTE_SIZE, 0, EMOTE_SIZE, EMOTE_SIZE, x, y, EMOTE_SIZE, EMOTE_SIZE);
	}
	//#endregion
	//#region ../cerebro/ui/src/lib/scene/ticker.ts
	const FRAME_MS = 100;
	const subscribers = /* @__PURE__ */ new Set();
	let running = true;
	let handle;
	let last = 0;
	function loop(now) {
		handle = void 0;
		if (!running || subscribers.size === 0) return;
		if (now - last >= FRAME_MS) {
			last = now;
			const seconds = Date.now() / 1e3;
			subscribers.forEach((draw) => draw(seconds));
		}
		handle = requestAnimationFrame(loop);
	}
	function kick() {
		if (running && handle === void 0 && subscribers.size > 0) handle = requestAnimationFrame(loop);
	}
	/** Registers a draw callback; returns the unsubscribe function. */
	function onFrame(draw) {
		subscribers.add(draw);
		draw(Date.now() / 1e3);
		kick();
		return () => subscribers.delete(draw);
	}
	function setAnimating(on) {
		running = on;
		if (!on && handle !== void 0) {
			cancelAnimationFrame(handle);
			handle = void 0;
		}
		kick();
	}
	//#endregion
	//#region ../cerebro/ui/src/lib/format.ts
	function humanizeDuration(ms) {
		const s = Math.max(0, Math.floor(ms / 1e3));
		if (s < 60) return `${s}s`;
		if (s < 3600) return `${Math.floor(s / 60)}min`;
		if (s < 86400) return `${Math.floor(s / 3600)}h${String(Math.floor(s % 3600 / 60)).padStart(2, "0")}`;
		return `${Math.floor(s / 86400)}d`;
	}
	const STATUS_LABELS = {
		busy: "busy",
		idle: "idle",
		waiting: "needs you"
	};
	//#endregion
	exports.CHARACTER_SCALE = CHARACTER_SCALE;
	exports.STATUS_LABELS = STATUS_LABELS;
	exports.drawScene = drawScene;
	exports.humanizeDuration = humanizeDuration;
	exports.onFrame = onFrame;
	exports.setAnimating = setAnimating;
	return exports;
})({});
