/* eslint-disable no-shadow, prefer-const, no-unused-vars */

/*
	==========================
	UPDATED VERSION 09.11.2021
	==========================
*/

const fs = require("fs"),
	path = require("path"),
	AHK = require("./lib/ahk.js");

const DataCenter_ClassNames = {
	"warrior": "Warrior",
	"lancer": "Lancer",
	"slayer": "Slayer",
	"berserker": "Berserker",
	"sorcerer": "Sorcerer",
	"archer": "Archer",
	"priest": "Priest",
	"elementalist": "Mystic",
	"soulless": "Reaper",
	"engineer": "Gunner",
	"fighter": "Brawler",
	"assassin": "Ninja",
	"glaiver": "Valkyrie"
};

module.exports = function MacroMaker(mod) {
	const { player } = mod.require.library, { command } = mod;
	const teraPid = mod.clientInterface.info.pid, selfPid = process.pid;

	let ahk = null,
		macroFile = null,
		macroConfig = null,
		hotkeyActions = {},
		skillActions = {},
		playerStats = {},
		reloading = false,
		loading = false,
		cooldownInterval = null,
		cooldowns = {},
		lastCast = {},
		intervalLocks = {},
		holdedKeys = {},
		releaseTimers = {},
		emulatedSkills = {},
		enterGameEvent = null,
		leaveGameEvent = null,
		enterCombatEvent = null,
		leaveCombatEvent = null,
		debugMode = false,
		abnormalDebug = false,
		lastSkill = null,
		lastTime = null,
		lastSpeed = null,
		useOutput = null,
		useRepeater = null,
		useInput = null,
		compiled = null;

	mod.game.initialize("me.abnormalities");
	AHK.init(mod.settings.ahkPath.replace(/%(.+?)%/g, (_, match) => process.env[match] || _));

	if (!fs.existsSync(path.join(__dirname, "ahk"))) {
		fs.mkdirSync(path.join(__dirname, "ahk"));
	}

	let regexOut = null;
	fs.readdirSync(path.join(__dirname, "ahk"))
		.filter(x => path.extname(x) === ".ahk" && (!(regexOut = /[a-z]+_(\d+)_\d+/g.exec(path.basename(x))) || regexOut[1] != selfPid))
		.forEach(file => {
			try {
				fs.unlinkSync(path.join(__dirname, "ahk", file));
			} catch (e) { }
		});

	mod.setTimeout(() => {
		if (mod.game.isIngame && !reloading && !macroFile) {
			let currentPath = null;

			if (fs.existsSync(currentPath = path.join(__dirname, "macros", `${mod.game.me.name}-${mod.game.me.serverId}.js`)) ||
				fs.existsSync(currentPath = path.join(__dirname, "macros", `${mod.game.me.name}.js`)) ||
				fs.existsSync(currentPath = path.join(__dirname, "macros", `${DataCenter_ClassNames[mod.game.me.class]}.js`))
			) {
				macroFile = currentPath;
				compileAndRunMacro();
			}
		}
	}, 1000);

	mod.game.on("enter_game", enterGameEvent = () => {
		let currentPath = null;
		if (ahk) {
			ahk.destructor();
			ahk = null;
		}

		if (fs.existsSync(currentPath = path.join(__dirname, "macros", `${mod.game.me.name}-${mod.game.me.serverId}.js`)) ||
			fs.existsSync(currentPath = path.join(__dirname, "macros", `${mod.game.me.name}.js`)) ||
			fs.existsSync(currentPath = path.join(__dirname, "macros", `${DataCenter_ClassNames[mod.game.me.class]}.js`))
		) {
			macroFile = currentPath;
			compileAndRunMacro();
		}
	});

	mod.game.on("leave_game", leaveGameEvent = () => {
		if (ahk) {
			ahk.destructor();
			ahk = null;

			hotkeyActions = {};
			skillActions = {};
			playerStats = {},
			lastCast = {};
			cooldowns = {};
			emulatedSkills = {};
			intervalLocks = {};
			holdedKeys = {};
		}
	});

	if (mod.settings.repeaterOnlyInCombat) {
		mod.game.me.on("enter_combat", enterCombatEvent = () => {
			if (mod.settings.enabled && ahk) {
				ahk.keyTap("f24", "");
			}
		});

		mod.game.me.on("leave_combat", leaveCombatEvent = () => {
			if (mod.settings.enabled && ahk) {
				ahk.keyTap("f23", "");
			}
		});
	}

	command.add("macro", {
		debug(type) {
			if (!type) {
				debugMode = !debugMode;
				command.message(`Debug mode is now ${debugMode ? "enabled" : "disabled"}.`);
			} else {
				switch (type.toLowerCase()) {
					case "abnormal": {
						abnormalDebug = !abnormalDebug;
						command.message(`Abnormal debug is now ${abnormalDebug ? "enabled" : "disabled"}.`);
						break;
					}
					default: {
						command.message(`Unknown debug type ${type}.`);
						break;
					}
				}
			}
		},
		async $default() {
			mod.settings.enabled = !mod.settings.enabled;
			if (mod.settings.enabled) {
				if (compiled) {
					runAhk(useInput, useOutput, useRepeater);
				} else {
					await compileAndRunMacro();
				}
			} else if (ahk) {
				ahk.destructor();
				ahk = null;
			}

			command.message(`Macros are now ${mod.settings.enabled ? "enabled" : "disabled"}.`);
		}
	});

	function getModifiersAndKey(hotkey) {
		const [key, ...modifiers] = hotkey.toLowerCase().split("+").reverse();

		return [`${modifiers.map(x => x.trim())
			.filter(x => ["shift", "ctrl", "alt"].includes(x))
			.map(x => ({ "shift": "+", "ctrl": "^", "alt": "!" }[x]))
			.join("")}`, `${{ "left-click": "LButton", "right-click": "RButton", "middle-click": "MButton" }[key] || key}`];
	}

	function compileAndRunMacro() {
		if (!macroFile) return;
		macroConfig = require(macroFile);
		if (!macroConfig.enabled) return;

		const keys = new Set();
		const repeaterKeys = new Set();

		useOutput = false;
		useRepeater = false;
		useInput = false;

		if (macroConfig.hotkeys) {
			for (let [key, hotkey] of Object.entries(macroConfig.hotkeys)) {
				if (typeof hotkey !== "object" || hotkey.enabled !== true) continue;

				key = getModifiersAndKey(key).join("");

				if (hotkey.repeater) {
					repeaterKeys.add(key);
				}

				const onPress = (typeof hotkey.onPress === "object" && !Array.isArray(hotkey.onPress)) ? [hotkey.onPress] : hotkey.onPress;

				if (Array.isArray(onPress) && onPress.length) {
					useInput = true;
					if (hotkeyActions[key]) {
						hotkeyActions[key] = hotkeyActions[key].concat(onPress);
					} else {
						hotkeyActions[key] = onPress;
					}

					keys.add(key);
				}
			}
		}

		if (macroConfig.skills) {
			for (const [skill, hotkey] of Object.entries(macroConfig.skills)) {
				if (typeof hotkey !== "object" || hotkey.enabled !== true) continue;

				if (typeof hotkey.key === "string") {
					const key = getModifiersAndKey(hotkey.key).join("");

					if (hotkey.repeater) {
						repeaterKeys.add(key);
					}

					const onPress = (typeof hotkey.onPress === "object" && !Array.isArray(hotkey.onPress)) ? [hotkey.onPress] : hotkey.onPress;

					if (Array.isArray(onPress) && onPress.length) {
						useInput = true;
						if (hotkeyActions[key]) {
							hotkeyActions[key] = hotkeyActions[key].concat(onPress);
						} else {
							hotkeyActions[key] = onPress;
						}

						keys.add(key);
					}
				}

				const onCast = (typeof hotkey.onCast === "object" && !Array.isArray(hotkey.onCast)) ? [hotkey.onCast] : hotkey.onCast;

				if (Array.isArray(onCast) && onCast.length) {
					useInput = true;
					if (skillActions[skill]) {
						skillActions[skill] = skillActions[skill].concat(onCast);
					} else {
						skillActions[skill] = onCast;
					}
				}
			}
		}

		const compilerPromises = [];

		if (keys.size) {
			useOutput = true;
			compilerPromises.push(AHK.compileOutputAhk(path.join(__dirname, "ahk", `output_${selfPid}_${teraPid}.ahk`), teraPid, [...keys]));
		}

		if (repeaterKeys.size) {
			useRepeater = true;
			compilerPromises.push(AHK.compileRepeaterAhk(
				path.join(__dirname, "ahk", `repeater_${selfPid}_${teraPid}.ahk`),
				teraPid, [...repeaterKeys],
				macroConfig.toggleRepeaterKey ? getModifiersAndKey(macroConfig.toggleRepeaterKey).join("") : "\\",
				mod.settings.repeaterStartSuspended
			));
		}

		if (useInput || mod.settings.repeaterOnlyInCombat) {
			useInput = true;
			compilerPromises.push(AHK.compileInputAhk(path.join(__dirname, "ahk", `input_${selfPid}_${teraPid}.ahk`), teraPid));
		}

		const promise = Promise.all(compilerPromises);

		promise.then(() => {
			runAhk(useInput, useOutput, useRepeater);
			compiled = true;
		}).catch(err => {
			mod.error(err);
			compiled = false;
		});

		return promise;
	}

	function handleAction(action, trigger) {
		const skillBaseId = trigger ? Math.floor(trigger.skill.id / 1e4) : 0;
		const skillAction = action.skill ? macroConfig.skills[action.skill] : undefined;
		const actionKey = action.skill ? skillAction.key : action.key;
		const delay = (action.delay || 0) / (action.fixedDelay === true ? 1 : Math.max(player.aspd, trigger ? trigger.speed : 0));
		const skillSubIds = (!Array.isArray(action.skillSubId) ? [action.skillSubId] : action.skillSubId).filter(x => !isNaN(x)).map(x => parseInt(x));

		if (!ahk || !actionKey || (!action.inHold && Object.keys(holdedKeys).length > 0)) return;

		if (trigger && skillSubIds.length > 0 && !skillSubIds.includes(trigger.skill.id % 100)) {
			return;
		}

		if (action.skillInterval) {
			if (intervalLocks[actionKey]) {
				return;
			}

			intervalLocks[actionKey] = true;
			mod.setTimeout(() => intervalLocks[actionKey] = false, action.skillInterval);
		}

		if (action.enableIfSkillCooldown) {
			const skills = (Array.isArray(action.enableIfSkillCooldown) ? action.enableIfSkillCooldown : [action.enableIfSkillCooldown]).map(x => parseInt(x)).filter(x => !isNaN(x));

			for (const skill of skills) {
				if (!cooldowns[skill] || Date.now() - cooldowns[skill].start >= cooldowns[skill].cooldown - delay) {
					return;
				}
			}
		}

		if (action.disableIfSkillCooldown) {
			const skills = (Array.isArray(action.disableIfSkillCooldown) ? action.disableIfSkillCooldown : [action.disableIfSkillCooldown]).map(x => parseInt(x)).filter(x => !isNaN(x));

			for (const skill of skills) {
				if (cooldowns[skill] && Date.now() - cooldowns[skill].start < cooldowns[skill].cooldown - delay) {
					return;
				}
			}
		}

		if (action.enableIfAbnormality) {
			const abnormalities = (Array.isArray(action.enableIfAbnormality) ? action.enableIfAbnormality : [action.enableIfAbnormality]).map(x => parseInt(x)).filter(x => !isNaN(x));

			for (const abnormalityId of abnormalities) {
				const abnormality = mod.game.me.abnormalities[abnormalityId];
				if (!abnormality) return;

				if (abnormality.remaining < delay) {
					return;
				}
			}
		}

		if (action.disableIfAbnormality) {
			const abnormalities = (Array.isArray(action.disableIfAbnormality) ? action.disableIfAbnormality : [action.disableIfAbnormality]).map(x => parseInt(x)).filter(x => !isNaN(x));

			for (const abnormalityId of abnormalities) {
				const abnormality = mod.game.me.abnormalities[abnormalityId];
				if (!abnormality) continue;

				if (abnormality.remaining >= delay) {
					return;
				}
			}
		}

		if (action.disableIfEdge) {
			const playerEdges = Object.keys(Object.fromEntries(Object.entries(playerStats).filter(([key, value]) => value !== 0 && /Edge$/.test(key)))).map(x => x.replace(/Edge$/, ""));
			const edges = Array.isArray(action.disableIfEdge) ? action.disableIfEdge : [action.disableIfEdge];

			for (const edge of edges) {
				if (playerEdges.includes(edge.toLowerCase())) {
					return;
				}
			}
		}

		if (action.enableIfEdge) {
			const playerEdges = Object.keys(Object.fromEntries(Object.entries(playerStats).filter(([key, value]) => value !== 0 && /Edge$/.test(key)))).map(x => x.replace(/Edge$/, ""));
			const edges = Array.isArray(action.enableIfEdge) ? action.enableIfEdge : [action.enableIfEdge];

			for (const edge of edges) {
				if (!playerEdges.includes(edge.toLowerCase())) {
					return;
				}
			}
		}

		if (typeof action.inCombat === "boolean" && action.inCombat !== mod.game.me.inCombat) {
			return;
		}

		const modifiersAndKey = getModifiersAndKey(actionKey).reverse();

		switch (action.action.toLowerCase()) {
			case "keytap": {
				mod.setTimeout(() => {
					if (action.holdDuration || (skillAction && skillAction.chargeStages)) {
						keyPress(skillAction, action.holdDuration || 2000);
					} else {
						ahk.keyTap(...modifiersAndKey);
					}
				}, delay);
				break;
			}
			case "keyrepeat": {
				mod.setTimeout(() => {
					ahk.keyRepeat(
						...modifiersAndKey,
						action.duration,
						action.interval,
						(action.stopOnNextCast && trigger) ? skillBaseId : 0,
						(action.stopOnNextCast && trigger) ? lastCast : { "skill": 0 }
					);
				}, delay);
				break;
			}
			default: {
				mod.warn(`Unknown action ${action.action}`);
				break;
			}
		}
	}

	function keyPress(skillAction, timeout) {
		if (!ahk || holdedKeys[skillAction.key]) return;

		ahk.keyDown(...getModifiersAndKey(skillAction.key).reverse());

		holdedKeys[skillAction.key] = mod.setTimeout(() => {
			if (holdedKeys[skillAction.key]) {
				ahk.keyUp(...getModifiersAndKey(skillAction.key).reverse());

				delete holdedKeys[skillAction.key];
			}
		}, timeout);
	}

	function keyRelease(skillAction) {
		if (!ahk) return;

		if (holdedKeys[skillAction.key]) {
			mod.clearTimeout(holdedKeys[skillAction.key]);
			ahk.keyUp(...getModifiersAndKey(skillAction.key).reverse());

			delete holdedKeys[skillAction.key];
		}
	}

	function keyReleaseAll() {
		if (!ahk) return;

		Object.keys(holdedKeys).forEach(actionKey => {
			mod.clearTimeout(holdedKeys[actionKey]);
			ahk.keyUp(...getModifiersAndKey(actionKey).reverse());
		});

		holdedKeys = {};
	}

	function runAhk(useInput, useOutput, useRepeater) {
		if (reloading || ahk) return;

		ahk = new AHK(
			useInput ? path.join(__dirname, "ahk", `input_${selfPid}_${teraPid}.ahk`) : false,
			useOutput ? path.join(__dirname, "ahk", `output_${selfPid}_${teraPid}.ahk`) : false,
			useRepeater ? path.join(__dirname, "ahk", `repeater_${selfPid}_${teraPid}.ahk`) : false
		);

		if (useOutput) {
			ahk.on("hotkey_press", hotkey => {
				if (!mod.settings.enabled) return;

				if (hotkeyActions[hotkey]) {
					hotkeyActions[hotkey].forEach(action => handleAction(action));
				}
			});

			ahk.on("hotkey_release", () => {
				if (!mod.settings.enabled) return;

				keyReleaseAll();
			});
		}
	}

	mod.hook("S_ACTION_STAGE", 9, { "order": -Infinity, "filter": { "fake": null } }, (event, fake) => {
		if (!mod.settings.enabled || event.gameId !== mod.game.me.gameId) return;

		if (!(event.skill.id in emulatedSkills)) {
			emulatedSkills[event.skill.id] = fake;
		} else if (emulatedSkills[event.skill.id] !== fake) {
			return;
		}

		const skillBaseId = Math.floor(event.skill.id / 1e4);
		const skillSubId = event.skill.id % 100;
		const skillAction = macroConfig ? macroConfig.skills[skillBaseId] : undefined;

		if (debugMode) {
			command.message(`skillId: ${skillBaseId} subId: ${skillSubId} stage: ${event.stage} (${Math.ceil((Date.now() - lastTime) * lastSpeed)}ms)`);
			lastSkill = event.skill.id;
			lastTime = Date.now();
			lastSpeed = Math.max(player.aspd, event.speed);
		}

		if (skillAction && skillAction.chargeStages == event.stage) {
			keyRelease(skillAction);
		}

		if (!ahk || event.stage !== 0) return;

		lastCast = { "skill": skillBaseId };

		if (skillActions[skillBaseId]) {
			skillActions[skillBaseId].forEach(action => handleAction(action, event));
		}

		if (releaseTimers[skillBaseId]) {
			mod.clearTimeout(releaseTimers[skillBaseId]);
			delete releaseTimers[skillBaseId];
		}
	});

	mod.hook("S_ACTION_END", 5, { "order": -Infinity, "filter": { "fake": null } }, (event, fake) => {
		if (!mod.settings.enabled || event.gameId !== mod.game.me.gameId) return;

		if (!(event.skill.id in emulatedSkills)) {
			emulatedSkills[event.skill.id] = fake;
		} else if (emulatedSkills[event.skill.id] !== fake) {
			return;
		}

		const skillBaseId = Math.floor(event.skill.id / 1e4);
		const skillAction = macroConfig ? macroConfig.skills[skillBaseId] : undefined;

		if (skillAction) {
			if (releaseTimers[skillBaseId]) {
				mod.clearTimeout(releaseTimers[skillBaseId]);
				delete releaseTimers[skillBaseId];
			}

			releaseTimers[skillBaseId] = mod.setTimeout(() => keyRelease(skillAction), 100 / player.aspd);
		}
	});

	mod.hook("C_PRESS_SKILL", mod.majorPatchVersion >= 114 ? 5 : 4, { "order": -Infinity }, event => {
		if (!mod.settings.enabled) return;

		const skillBaseId = Math.floor(event.skill.id / 1e4);
		const skillAction = macroConfig ? macroConfig.skills[skillBaseId] : undefined;

		if (!event.press && skillAction) {
			keyRelease(skillAction);
		}
	});

	mod.hook("S_CANNOT_START_SKILL", 4, { "order": -Infinity }, event => {
		if (!mod.settings.enabled) return;

		const skillBaseId = Math.floor(event.skill.id / 1e4);
		const skillAction = macroConfig ? macroConfig.skills[skillBaseId] : undefined;

		if (skillAction) {
			if (releaseTimers[skillBaseId]) {
				mod.clearTimeout(releaseTimers[skillBaseId]);
				delete releaseTimers[skillBaseId];
			}

			keyRelease(skillAction);
		}
	});

	mod.hook("C_CANCEL_SKILL", 3, { "order": -Infinity }, event => {
		if (!mod.settings.enabled) return;

		const skillBaseId = Math.floor(event.skill.id / 1e4);
		const skillAction = macroConfig ? macroConfig.skills[skillBaseId] : undefined;

		if (skillAction) {
			if (releaseTimers[skillBaseId]) {
				mod.clearTimeout(releaseTimers[skillBaseId]);
				delete releaseTimers[skillBaseId];
			}

			keyRelease(skillAction);
		}
	});

	mod.hook("S_START_COOLTIME_SKILL", mod.majorPatchVersion >= 114 ? 4 : 3, { "order": Infinity }, sStartCooltimeSkill);
	mod.hook("S_DECREASE_COOLTIME_SKILL", mod.majorPatchVersion >= 114 ? 4 : 3, { "order": Infinity }, sStartCooltimeSkill);

	function sStartCooltimeSkill(event) {
		if (!mod.settings.enabled) return;

		const skillBaseId = Math.floor(event.skill.id / 1e4);
		cooldowns[skillBaseId] = { "start": Date.now(), "cooldown": event.cooldown };

		if (cooldownInterval === null) {
			let now = Date.now();

			cooldownInterval = mod.setInterval(() => {
				Object.keys(cooldowns).forEach(skillId => {
					if (cooldowns[skillId].start + cooldowns[skillId].cooldown <= Date.now()) {
						delete cooldowns[skillId];
					} else if (mod.game.me.status === 2) {
						cooldowns[skillId].start -= Date.now() - now;
					}
				});

				if (cooldowns.length === 0) {
					mod.clearInterval(cooldownInterval);
					cooldownInterval = null;
				}

				now = Date.now();
			}, 1000);
		}
	}

	mod.hook("S_ABNORMALITY_BEGIN", mod.majorPatchVersion === 92 ? 3 : 5, { "order": Infinity, "filter": { "fake": null } }, event => {
		if (!mod.settings.enabled) return;
		if (!abnormalDebug || event.target !== mod.game.me.gameId || !(event.id in mod.game.me.abnormalities)) return;

		const abnormality = mod.game.me.abnormalities[event.id];
		command.message(`${abnormality.data.name || "Unnamed"} (ID: ${abnormality.id} duration: ${abnormality.data.time})`);
	});

	mod.hook("S_PLAYER_STAT_UPDATE", mod.majorPatchVersion === 92 ? 13 : 17, { "order": Infinity, "filter": { "fake": null } }, event => {
		if (!mod.settings.enabled) return;

		playerStats = event;
	});

	this.saveState = () => {
		reloading = true;
		command.message("Reloading and recompiling macros. Please wait until it's finished reloading.");

		return { macroFile };
	};

	this.loadState = state => {
		loading = true;
		macroFile = state.macroFile;

		const promise = compileAndRunMacro();

		if (promise) {
			promise.then(() => {
				loading = false;
				command.message("Finished reloading.");
			}).catch(() => {
				loading = false;
				command.message("Failed to compile macro while reloading.");
			});
		} else {
			command.message("Finished reloading.");
		}
	};

	this.destructor = () => {
		if (ahk) {
			ahk.destructor();
		}

		if (enterGameEvent) mod.game.off("enter_game", enterGameEvent);
		if (leaveGameEvent) mod.game.off("leave_game", leaveGameEvent);
		if (enterCombatEvent) mod.game.me.off("enter_combat", enterCombatEvent);
		if (leaveCombatEvent) mod.game.me.off("leave_combat", leaveCombatEvent);

		command.remove("macro");
	};
};