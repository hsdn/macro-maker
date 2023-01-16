// TeraToolbox AHK Library
// Authors: Matheus Belo / JKQ
// Version: 1.2
"use strict";

const fs = require("fs");
const EventEmitter = require("events");
const { spawn } = require("child_process");

const repeaterTemplate =
`#ErrorStdOut
#NoTrayIcon
#MaxHotkeysPerInterval 99999999999999999999
#HotkeyInterval 0
#SingleInstance Off

SetStoreCapslockMode, Off

{START_SUSPENDED}
$~f23::Enabled := false
$~f24::Enabled := true
{SUSPEND_KEY}::Enabled := !Enabled

{TRIGGER_KEYS}
	If (WinActive("ahk_pid {TERA_PID}") && Enabled) {
		Hotkey := StrReplace(A_ThisHotkey, "$")
		Hotkey := StrReplace(Hotkey, "~")
		IsShiftHotkey := 0
		IsCtrlHotkey := 0
		IsAltHotkey := 0
		Hotkey := StrReplace(Hotkey, "+", "", IsShiftHotkey)
		Hotkey := StrReplace(Hotkey, "^", "", IsCtrlHotkey)
		Hotkey := StrReplace(Hotkey, "!", "", IsAltHotkey)
		Modifiers := ""
		If (IsShiftHotkey > 0) {
			Modifiers = %Modifiers%+
		}
		If (IsCtrlHotkey > 0) {
			Modifiers = %Modifiers%^
		}
		If (IsAltHotkey > 0) {
			Modifiers = %Modifiers%!
		}
		While GetKeyState(Hotkey, "P") {
			Send, %Modifiers%{%Hotkey%}
			Sleep, 0
		}
	}
	Return
`;

const outputTemplate =
`#ErrorStdOut
#NoTrayIcon
#MaxHotkeysPerInterval 99999999999999999999
#HotkeyInterval 0
#SingleInstance Off

stdout := FileOpen("*", "w")

{TRIGGER_KEYS}
	If WinActive("ahk_pid {TERA_PID}") {
		GetModifierState() {
			If GetKeyState("Shift", "P")
				Modifiers .= "+"
			If GetKeyState("Control", "P")
				Modifiers .= "^"
			If GetKeyState("Alt", "P")
				Modifiers .= "!"

			return Modifiers
		}

		StripAllModifiers(PressedKey) {
			StringReplace, PressedKey, PressedKey, ^
			StringReplace, PressedKey, PressedKey, +
			StringReplace, PressedKey, PressedKey, !
			StringReplace, PressedKey, PressedKey, *
			StringReplace, PressedKey, PressedKey, ~
			StringReplace, PressedKey, PressedKey, $
	
			return PressedKey
		}

		StripModifiers(PressedKey) {
			StringReplace, PressedKey, PressedKey, ~
			StringReplace, PressedKey, PressedKey, $
	
			return PressedKey
		}

		UnmodifiedKey := StripAllModifiers(A_ThisHotkey)
		WritenHotkey := StripModifiers(A_ThisHotkey)
		ThisHotkey := GetModifierState() UnmodifiedKey

		while GetKeyState(UnmodifiedKey, "P")
			&& ((instr(ThisHotkey, "+") && GetKeyState("Shift", "P")) || !instr(ThisHotkey, "+"))
			&& ((instr(ThisHotkey, "^") && GetKeyState("Ctrl", "P")) || !instr(ThisHotkey, "^"))
			&& ((instr(ThisHotkey, "!") && GetKeyState("Alt", "P")) || !instr(ThisHotkey, "!"))
		{
			stdout.Write(WritenHotkey " down")
			stdout.Read(0)
			Sleep, {INTERVAL_DELAY}
		}

		stdout.Write(WritenHotkey " up")
		stdout.Read(0)
	}
	Return
`;

const inputTemplate =
`#NoTrayIcon
#SingleInstance Off

stdin := FileOpen("*", "r \`n")
SetKeyDelay, -1
SetMouseDelay, -1
SetStoreCapslockMode, Off

Loop {
	query := RTrim(stdin.ReadLine(), "\`n")
	If (query == "{f23}" || query == "{f24}") {
		SendLevel, 1
		Send, %query%
		SendLevel, 0
	} Else If WinActive("ahk_pid {TERA_PID}") {
		Send, %query%
	}
}
`;

class AHK extends EventEmitter {
	constructor(input, output, repeater) {
		super();
		this.setMaxListeners(0);
		if (input && fs.existsSync(input)) {
			this.spawnInput(input);
		}
		if (output && fs.existsSync(output)) {
			this.spawnOutput(output);
		}
		if (repeater && fs.existsSync(repeater)) {
			this.spawnRepeater(repeater);
		}
	}

	destructor() {
		if (this.inputAhk && !this.inputAhk.exitCode) {
			this.inputAhk.kill();
		}
		if (this.outputAhk && !this.outputAhk.exitCode) {
			this.outputAhk.kill();
		}
		if (this.repeaterAhk && !this.repeaterAhk.exitCode) {
			this.repeaterAhk.kill();
		}
	}

	spawnInput(input) {
		this.inputAhk = spawn(AHK.path, [input]);

		this.inputAhk.on("exit", code => {
			if (code === 0) {
				console.log("Please don't close ahk scripts manually. Restarting script.");
				this.spawnInput(input);
			}
		});
	}

	spawnOutput(output) {
		this.outputAhk = spawn(AHK.path, [output]);

		this.outputAhk.stdout.on("data", data => {
			const [key, state] = data.toString().split(" ");
			this.emit(state == "down" ? "hotkey_press" : "hotkey_release", key);
		});

		this.outputAhk.on("exit", code => {
			if (code === 0) {
				console.log("Please don't close ahk scripts manually. Restarting script.");
				this.spawnOutput(output);
			}
		});
	}

	spawnRepeater(repeater) {
		this.repeaterAhk = spawn(AHK.path, [repeater]);

		this.repeaterAhk.on("exit", code => {
			if (code === 0) {
				console.log("Please don't close ahk scripts manually. Restarting script.");
				this.spawnRepeater(repeater);
			}
		});
	}

	keyTap(key, modifiers) {
		if (this.inputAhk.exitCode) return;

		this.inputAhk.stdin.write(`${modifiers}{${key}}\n`);
	}

	keyDown(key, modifiers) {
		if (this.inputAhk.exitCode) return;

		this.inputAhk.stdin.write(`${modifiers}{${key} down}\n`);
	}

	keyUp(key, modifiers) {
		if (this.inputAhk.exitCode) return;

		this.inputAhk.stdin.write(`${modifiers}{${key} up}\n`);
	}

	keyRepeat(key, modifiers, duration, interval, trigger = 0, lastCast = { "skill": 0 }) {
		if (duration && interval) {
			let timeoutId = null;

			const intervalId = setInterval(() => {
				if (lastCast.skill !== trigger) {
					clearInterval(intervalId);
					clearTimeout(timeoutId);
					return;
				}
				this.keyTap(key, modifiers);
			}, interval);

			setImmediate(() => {
				if (lastCast.skill !== trigger) return;
				this.keyTap(key, modifiers);
			});

			timeoutId = setTimeout(() => {
				clearInterval(intervalId);
			}, duration);
		}
	}
}

module.exports = AHK;

module.exports.init = (ahkPath) => {
	if (fs.existsSync(ahkPath)) {
		AHK.path = ahkPath;
	} else {
		throw new Error(`${ahkPath} not found.`);
	}
};

function validateAhk(ahkPath, resolve, reject) {
	const validateAhkProcess = spawn(AHK.path, [ahkPath]);

	setTimeout(() => {
		if (!validateAhkProcess.exitCode) {
			validateAhkProcess.kill();
		}
	}, 5000);

	validateAhkProcess.stderr.on("data", data => reject(data.toString()));

	validateAhkProcess.on("error", err => {
		if (err.errno === "ENOENT") {
			reject("Couldn't find AutoHotkey.exe.");
		} else {
			reject(err);
		}
	});

	validateAhkProcess.on("exit", code => {
		if (code === 2) {
			reject("Script exited with code 2.");
		} else {
			resolve();
		}
	});
}

module.exports.compileOutputAhk = (dest, pid, keys, intervalDelay = 100) => new Promise((resolve, reject) => {
	if (!keys.length) return reject("No keys specified.");

	let compiledCode = outputTemplate.replace("{TRIGGER_KEYS}", keys.map(key => `$~${key}::`).join("\r\n"));
	compiledCode = compiledCode.replace("{INTERVAL_DELAY}", intervalDelay);
	compiledCode = compiledCode.replace("{TERA_PID}", pid);

	fs.writeFileSync(dest, compiledCode);

	validateAhk(dest, resolve, reject);
});

module.exports.compileRepeaterAhk = (dest, pid, keys, suspendKey, startSuspended = false) => new Promise((resolve, reject) => {
	if (!keys.length) return reject("No keys specified.");

	let compiledCode = repeaterTemplate.replace("{TRIGGER_KEYS}", keys.map(key => `$~${key}::`).join("\r\n"));
	compiledCode = compiledCode.replace("{SUSPEND_KEY}", suspendKey);
	compiledCode = compiledCode.replace("{START_SUSPENDED}", startSuspended ? "Enabled := false" : "Enabled := true");
	compiledCode = compiledCode.replace("{TERA_PID}", pid);

	fs.writeFileSync(dest, compiledCode);

	validateAhk(dest, resolve, reject);
});

module.exports.compileInputAhk = (dest, pid) => new Promise((resolve, reject) => {
	const compiledCode = inputTemplate.replace("{TERA_PID}", pid);

	fs.writeFileSync(dest, compiledCode);

	validateAhk(dest, resolve, reject);
});
