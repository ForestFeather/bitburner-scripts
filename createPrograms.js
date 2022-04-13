/** @param {NS} ns **/
export async function main(ns) {
	const exeList = ["Autolink.exe", "BruteSSH.exe", "DeepscanV1.exe", "ServerProfiler.exe",  "FTPCrack.exe", "relaySMTP.exe", "DeepscanV2.exe", "HTTPWorm.exe", "SQLInject.exe" ];
	const reqLevel = [25, 50, 75, 75, 100, 250, 400, 500, 750];
	let createdPrograms = 0;

	ns.tprint("Launching createPrograms.js");

	while(createdPrograms <= exeList.length) {

		// Reset counter
		createdPrograms = 0;
		if(!ns.isBusy()) {
			for (let i = 0; i < exeList.length; i++) {
				
				ns.print("Checking Program: " + exeList[i]);
				
				if(ns.fileExists(exeList[i])) { 
					createdPrograms++; 
				}
				else if(ns.getHackingLevel() >= reqLevel[i]) {
					ns.tprint("Creating Program: " + exeList[i]);
					ns.createProgram(exeList[i]);
				} else { ns.print("Not high enough to create " + exeList[i]); }
			}
		} else { ns.print("Currently focused, skipping."); }

		await ns.sleep(16317);
	}

	ns.tprint("Created all EXEs, closing.");
}