/** @param {NS} ns **/
export async function main(ns) {
	const exeList = ["Autolink.exe", "BruteSSH.exe", "DeepscanV1.exe", "DeepscanV2.exe", "FTPCrack.exe", "Formulas.exe", "HTTPWorm.exe", "NUKE.exe", "SQLInject.exe", "ServerProfiler.exe", "relaySMTP.exe" ];
	let ownedPrograms = 0;

	ns.tprint("Launching buyPrograms.js");

	while(ownedPrograms <= exeList.length) {
		// Get TOR router
		ns.purchaseTor();

		// Reset counter
		ownedPrograms = 0;

		exeList.forEach(function (exe) {
			if(ns.fileExists(exe)) { ownedPrograms++; }
			else {
				let boughtProgram = ns.purchaseProgram(exe);
				if(boughtProgram) { ns.tprint("Purchased " + exe); ownedPrograms++; }
			}
		})

		await ns.sleep(115739);
	}

	ns.tprint("Purchased all EXEs, closing.");
}