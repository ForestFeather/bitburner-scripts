/** @param {NS} ns **/
export async function main(ns) {
	function myMoney() {
		return ns.getServerMoneyAvailable("home");
	}

	//this script is designed to manage the hacknet nodes
	//to prevent excess spending i've limited it from spending
	//more than half the players money
	let maxNodes = ns.args.length > 0 ? ns.args[0] : ns.hacknet.hashCapacity() > 0 ? 24 : 8;
	let maxLevel = ns.args.length > 1 ? ns.args[1] : ns.hacknet.hashCapacity() > 0 ? 500 : 200;
	let maxRam = ns.args.length > 2 ? ns.args[2] : ns.hacknet.hashCapacity() > 0 ? 1024 : 64;
	let maxCores = ns.args.length > 3 ? ns.args[3] : ns.hacknet.hashCapacity() > 0 ? 32 : 17;
	var nodes = 0;
	var ref = 0;
	let nodesMaxed = 0;
	//ns.disableLog("ALL");

	ns.tprint("Attempting to purchase and max out " + maxNodes + " nodes at " + maxLevel + " level, " + maxRam + " ram, and " + maxCores + " cores.");

	while (ns.hacknet.numNodes() < maxNodes || nodesMaxed < maxNodes) {
		//sleep for second to prevent the loop from crashing the game
		await ns.sleep(10000);

		//buy a node if we have more than twice the money needed
		if (ns.hacknet.getPurchaseNodeCost() < myMoney() / 2 && ns.hacknet.numNodes() < maxNodes) {
			ref = ns.hacknet.purchaseNode();
			ns.tprint("bought node hn-" + ref);
			ns.toast("Bought Node - hn-" + ref);
		}

		// spend hashes
		if (ns.hacknet.numHashes() > ns.hacknet.hashCost("Exchange for Bladeburner SP") * 2 ||
			ns.hacknet.numHashes() == ns.hacknet.hashCapacity()) {
			ns.hacknet.spendHashes("Exchange for Bladeburner SP");
			while (ns.hacknet.numHashes() > 4) {
				ns.hacknet.spendHashes("Sell for Money");
			}
		}

		//Variables
		nodesMaxed = 0;
		nodes = ns.hacknet.numNodes()

		for (var i = 0; i < nodes; i++) {
			var nodeStats = ns.hacknet.getNodeStats(i);

			//check if nodes level is a multiple of 10
			var mod = nodeStats.level % 10;

			// Check for maxed node
			if (nodeStats.level == maxLevel && nodeStats.ram == maxRam && nodeStats.cores == maxCores) {
				nodesMaxed++;
			}

			// Otherwise, buy!
			else {
				//buy level node to the nearest multiple of 10 if we have double the money needed
				if (ns.hacknet.getLevelUpgradeCost(i, 10 - mod) < myMoney() / 2 && nodeStats.level <= maxLevel) {
					ns.hacknet.upgradeLevel(i, 10 - mod);
					ns.tprint("node hn-" + i + " leveled up");
					ns.toast("node hn-" + i + " leveled up");
				}
				//same for ram
				if (ns.hacknet.getRamUpgradeCost(i) < myMoney() / 2 && nodeStats.ram <= maxRam) {
					ns.hacknet.upgradeRam(i);
					ns.tprint("node hn-" + i + " ram upgraded");
					ns.toast("node hn-" + i + " ram upgraded");
				}
				//and cores
				if (ns.hacknet.getCoreUpgradeCost(i) < myMoney() / 2 && nodeStats.cores <= maxCores) {
					ns.hacknet.upgradeCore(i);
					ns.tprint("node hn-" + i + " core upgraded");
					ns.toast("node hn-" + i + " core upgraded");
				}

				//and hash capacity
				if (ns.hacknet.hashCapacity() > 0 && ns.hacknet.getCacheUpgradeCost(i) < myMoney() / 2) {
					ns.hacknet.upgradeCache(i);
					ns.tprint("node hn-" + i + " cache upgraded");
					ns.toast("node hn-" + i + " cache upgraded");
				}
			}
		}
	}

	ns.tprint("Purchased " + maxNodes + " maxed nodes, exiting.");
}