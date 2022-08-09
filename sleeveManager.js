// Setup
const interval = 11000;
const minTaskWorkTime = 29000; // Work for 29 seconds minimum
const works = ['security', 'field', 'hacking'];
const trainStats = ['strength', 'defense', 'dexterity', 'agility'];

let cachedCrimeStats, workByFaction; // Cache of crime statistics and which factions support which work
let task, lastStatusUpdateTime, lastPurchaseTime, lastPurchaseStatusUpdate, availableAugs, cacheExpiry, lastReassignTime; // State by sleeve
let numSleeves, ownedSourceFiles, playerInGang, bladeburnerCityChaos, bladeburnerTaskFailed;
let options;

const argsSchema = {
	'min-shock-recovery': 97, // Minimum shock recovery before attempting to train or do crime (Set to 100 to disable, 0 to recover fully)
	'shock-recovery': 0.05, // Set to a number between 0 and 1 to devote that ratio of time to periodic shock recovery (until shock is at 0)
	'crime': null, // If specified, sleeves will perform only this crime regardless of stats
	'homicide-chance-threshold': 0.45, // Sleeves will automatically start homicide once their chance of success exceeds this ratio
	'aug-budget': 0.5, // Spend up to this much of current cash on augs per tick (Default is high, because these are permanent for the rest of the BN)
	'buy-cooldown': 60 * 1000, // Must wait this may milliseconds before buying more augs for a sleeve
	'min-aug-batch': 10, // Must be able to afford at least this many augs before we pull the trigger (or fewer if buying all remaining augs)
	'reserve': 1000000, // Reserve this much cash before determining spending budgets (defaults to contents of reserve.txt if not specified)
	'disable-follow-player': false, // Set to true to disable having Sleeve 0 work for the same faction/company as the player to boost re
	'disable-training': false, // Set to true to disable having sleeves workout at the gym (costs money)
	'train-to-strength': 105, // Sleeves will go to the gym until they reach this much Str
	'train-to-defense': 105, // Sleeves will go to the gym until they reach this much Def
	'train-to-dexterity': 70, // Sleeves will go to the gym until they reach this much Dex
	'train-to-agility': 70, // Sleeves will go to the gym until they reach this much Agi
	'training-reserve': 0, // Defaults to global reserve.txt. Can be set to a negative number to allow debt. Sleeves will not train if money is below this amount.
	'disable-spending-hashes-for-gym-upgrades': false, // Set to true to disable spending hashes on gym upgrades when training up sleeves.
};

/** @param {NS} ns */
export async function main(ns) {
	// Ensure the global state is reset (e.g. after entering a new bitnode)
	task = [], lastStatusUpdateTime = [], lastPurchaseTime = [], lastPurchaseStatusUpdate = [], availableAugs = [],
		cacheExpiry = [], lastReassignTime = [], bladeburnerTaskFailed = [];
	workByFaction = {}, cachedCrimeStats = {};

	ownedSourceFiles = ns.getOwnedSourceFiles();

	while (true) {
		try { await mainLoop(ns); }
		catch (err) {
			ns.print(`WARNING: sleeve.js Caught (and suppressed) an unexpected error in the main loop:\n` +
				(err?.stack || '') + (typeof err === 'string' ? err : err.message || JSON.stringify(err)));
		}
		await ns.sleep(interval);
	}
}


/** @param {NS} ns 
 * Main loop that gathers data, checks on all sleeves, and manages them. */
async function mainLoop(ns) {
	// Update info
	numSleeves = ns.sleeve.getNumSleeves();
	const playerInfo = ns.getPlayer();
	if (!playerInGang) playerInGang = ns.gang.inGang();
	let globalReserve = ns.getServerMoneyAvailable("home");
	let budget = (playerInfo.money - (argsSchema['reserve'] ) ) * argsSchema['aug-budget'];
	//ns.print(`Player Money: ${playerInfo.money} Reserve: ${argsSchema['reserve']} GlobalReserve: ${globalReserve} Aug-Budget: ${argsSchema['aug-budget']} Budget: ${budget}`);
	// Estimate the cost of sleeves training over the next time interval to see if (ignoring income) we would drop below our reserve.
	const costByNextLoop = interval / 1000 * task.filter(t => t.startsWith("train")).length * 12000; // TODO: Training cost/sec seems to be a bug. Should be 1/5 this ($2400/sec)
	let canTrain = !argsSchema['disable-training'] && (playerInfo.money - costByNextLoop) > (argsSchema['training-reserve'] ||
		(promptedForTrainingBudget ? ns.read(trainingReserveFile) : undefined) || globalReserve);
	// If any sleeve is training at the gym, see if we can purchase a gym upgrade to help them
	if (canTrain && task.some(t => t?.startsWith("train")) && !argsSchema['disable-spending-hashes-for-gym-upgrades'])
		if (ns.hacknet.spendHashes("Improve Gym Training"))
			ns.tPrint(`SUCCESS: Bought "Improve Gym Training" to speed up Sleeve training.`);
	if (playerInfo.inBladeburner && (7 in ownedSourceFiles)) {
		const bladeburnerCity = ns.bladeburner.getCity();
		bladeburnerCityChaos = ns.bladeburner.getCityChaos(bladeburnerCity);
	} else
		bladeburnerCityChaos = 0;

	// Update all sleeve stats and loop over all sleeves to do some individual checks and task assignments
	for (let i = 0; i < numSleeves; i++) {
		let sleeveStats = ns.sleeve.getSleeveStats(i);
		let sleeveInfo = ns.sleeve.getInformation(i);
		let sleeveTasks = ns.sleeve.getTask(i);
		let sleeveStuff = { ...sleeveStats, ...sleeveInfo, ...sleeveTasks }; // For convenience, merge all sleeve stats/info into one object
		
		//ns.print(`Sleeve Stuff: ${sleeveStuff.toString()}`)

		// MANAGE SLEEVE AUGMENTATIONS
		//ns.print(`Checking sleeve augs...`);
		if (sleeveStuff.shock == 0) // No augs are available augs until shock is 0
			budget -= await manageSleeveAugs(ns, i, budget);

		// ASSIGN SLEEVE TASK
		// These tasks should be immediately discontinued in certain conditions, even if it hasn't been 'minTaskWorkTime'
		if (task[i] == "recover from shock" && sleeveStuff.shock == 0 ||
			task[i] == "synchronize" && sleeveStuff.sync == 100 ||
			task[i]?.startsWith("train") && !canTrain)
			lastReassignTime[i] = 0;
		// Otherwise, don't change tasks if we've changed tasks recently (avoids e.g. disrupting long crimes too frequently)
		if (Date.now() - (lastReassignTime[i] || 0) < minTaskWorkTime) continue;

		// Decide what we think the sleeve should be doing for the next little while
		let [designatedTask, command, args, statusUpdate] = await pickSleeveTask(ns, playerInfo, i, sleeveStuff, canTrain);

		// Start the clock, this sleeve should stick to this task for minTaskWorkTime
		lastReassignTime[i] = Date.now();
		// Set the sleeve's new task if it's not the same as what they're already doing.
		let assignSuccess = true;
		if (task[i] != designatedTask)
			assignSuccess = await setSleeveTask(ns, playerInfo, i, designatedTask, command, args);

		// For certain tasks, log a periodic status update.
		ns.print(`Assigned? ${assignSuccess} Status? ${statusUpdate} LastStatusUpdateTime? ${lastStatusUpdateTime[i]}`)
		if (assignSuccess && statusUpdate && (Date.now() - (lastStatusUpdateTime[i] ?? 0) > minTaskWorkTime)) {
			ns.tprint(`INFO: Sleeve ${i} is ${statusUpdate} `);
			lastStatusUpdateTime[i] = Date.now();
		}
	}
}

/** @param {NS} ns 
 * Purchases augmentations for sleeves */
async function manageSleeveAugs(ns, i, budget) {
	// Retrieve and cache the set of available sleeve augs (cached temporarily, but not forever, in case rules around this change)
	if (availableAugs[i] == null || Date.now() > cacheExpiry[i]) {
		cacheExpiry[i] = Date.now() + 60000;
		availableAugs[i] = (ns.sleeve.getSleevePurchasableAugs(i)  // list of { name, cost }
		).sort((a, b) => a.cost - b.cost);
	}
	//ns.print(`Num Augs for sleeve ${i} Available: ${availableAugs[i].length}`)
	if (availableAugs[i].length == 0) return 0;

	const cooldownLeft = Math.max(0, argsSchema['buy-cooldown'] - (Date.now() - (lastPurchaseTime[i] || 0)));
	const [batchCount, batchCost] = availableAugs[i].reduce(([n, c], aug) => c + aug.cost <= budget ? [n + 1, c + aug.cost] : [n, c], [0, 0]);
	const purchaseUpdate = `sleeve ${i} can afford ${batchCount.toFixed(0).padStart(2)}/${availableAugs[i].length.toFixed(0).padEnd(2)} remaining augs ` +
		`(cost ${formatMoney(batchCost)} of ${formatMoney(availableAugs[i].reduce((t, aug) => t + aug.cost, 0))}).`;
	ns.print(`${purchaseUpdate}`)
	if (lastPurchaseStatusUpdate[i] != purchaseUpdate)
		ns.print(`INFO: With budget ${formatMoney(budget)}, ${(lastPurchaseStatusUpdate[i] = purchaseUpdate)} ` +
			`(Min batch size: ${argsSchema['min-aug-batch']}, Cooldown: ${formatDuration(cooldownLeft)})`);
	if (cooldownLeft == 0 && batchCount > 0 && ((batchCount >= availableAugs[i].length - 1) || batchCount >= argsSchema['min-aug-batch'])) { // Don't require the last aug it's so much more expensive
		let strAction = `Purchase ${batchCount} augmentations for sleeve ${i} at total cost of ${formatMoney(batchCost)}`;
		let toPurchase = availableAugs[i].splice(0, batchCount);
		if (toPurchase.reduce((s, aug) => s && ns.sleeve.purchaseSleeveAug(i, aug.name), true)) {
			ns.print(`SUCCESS: ${strAction}`);
		} else ns.print(`ERROR: Failed to ${strAction}`);
		lastPurchaseTime[i] = Date.now();
		return batchCost; // Even if we think we failed, return the predicted cost so if the purchase did go through, we don't end up over-budget
	}

	//ns.print(`Fall through purchasing augs!`);
	return 0;
}

/** Picks the best task for a sleeve, and returns the information to assign and give status updates for that task.
 * @param {NS} ns 
 * @param {Player} playerInfo
 * @param {SleeveSkills | SleeveInformation | SleeveTask} sleeve */
async function pickSleeveTask(ns, playerInfo, i, sleeve, canTrain) {
	// Must synchronize first iif you haven't maxed memory on every sleeve.
	if (sleeve.sync < 100)
		return ["synchronize", `ns.sleeve.setToSynchronize(${i})`, `syncing... ${sleeve.sync.toFixed(2)}%`];
	// Opt to do shock recovery if above the --min-shock-recovery threshold, or if above 0 shock, with a probability of --shock-recovery
	if (sleeve.shock > argsSchema['min-shock-recovery'] || sleeve.shock > 0 && argsSchema['shock-recovery'] > 0 && Math.random() < argsSchema['shock-recovery'])
		return ["recover from shock", `ns.sleeve.setToShockRecovery(${i})`, `recovering from shock... ${sleeve.shock.toFixed(2)}%`];

	// Train if our sleeve's physical stats aren't where we want them
	//ns.print(`Checking to train sleeve`);
	if (canTrain) {
		let untrainedStats = trainStats.filter(stat => sleeve[stat] < argsSchema[`train-to-${stat}`]);
		if (untrainedStats.length > 0) {
			if (playerInfo.money > 5E6)
			if (sleeve.city != "Sector-12") {
				log(ns, `Moving Sleeve ${i} from ${sleeve.city} to Sector-12 so that they can study at Powerhouse Gym.`);
				ns.sleeve.travel(ns.args[i], ns.args["Sector-12"]);
			}
			var trainStat = untrainedStats.reduce((min, s) => sleeve[s] < sleeve[min] ? s : min, untrainedStats[0]);
			return [`train ${trainStat}`, `ns.sleeve.setToGymWorkout(${i}, 'Powerhouse Gym', ${trainStat})`,
            /*   */ `training ${trainStat}... ${sleeve[trainStat]}/${(argsSchema[`train-to-${trainStat}`])}`];
		}
	}
	// If player is currently working for faction or company rep, sleeves 0 can help him out (Note: Only one sleeve can work for a faction)
	if (i == 0 && !argsSchema['disable-follow-player'] && playerInfo.isWorking && playerInfo.workType == "Working for Faction") {
		// TODO: We should be able to borrow logic from work-for-factions.js to have more sleeves work for useful factions / companies
		// We'll cycle through work types until we find one that is supported. TODO: Auto-determine the most productive faction work to do.
		const faction = playerInfo.currentWorkFactionName;
		const work = works[workByFaction[faction] || 0];
		ns.print(`Work for faction!`)
		return [`work for faction '${faction}' (${work})`, `ns.sleeve.setToFactionWork(${i}, '${faction}', '${work}')`,
        /*   */ `helping earn rep with faction ${faction} by doing ${work}.`];
	}
	if (i == 0 && !argsSchema['disable-follow-player'] && playerInfo.isWorking && playerInfo.workType == "Working for Company") { // If player is currently working for a company rep, sleeves 0 shall help him out (only one sleeve can work for a company)
		ns.print(`Work for company~`);
		return [`work for company '${playerInfo.companyName}'`, `ns.sleeve.setToCompanyWork(${i}, '${playerInfo.companyName}')`,
        /*   */ `helping earn rep with company ${playerInfo.companyName}.`];
	}
	// If the player is in bladeburner, and has already unlocked gangs with Karma, generate contracts and operations
	if (playerInfo.inBladeburner && playerInGang) {

		ns.print(`Checking gang and bladeburner stuff`);
		// Hack: Without paying much attention to what's happening in bladeburner, pre-assign a variety of tasks by sleeve index
		const bbTasks = [/*0*/["Support main sleeve"], /*1*/["Take on contracts", "Retirement"],
            /*2*/["Take on contracts", "Bounty Hunter"], /*3*/["Take on contracts", "Tracking"], /*4*/["Infiltrate synthoids"],
            /*5*/["Diplomacy"], /*6*/["Field Analysis"], /*7*/["Recruitment"]];
		let [action, contractName] = bladeburnerCityChaos > 50 ? ["Diplomacy"] : bbTasks[i];
		// If the sleeve is performing an action with a chance of failure, fallback to another task
		if (sleeve.location.includes("%") && !sleeve.location.includes("100%"))
			bladeburnerTaskFailed[i] = Date.now(); // If not, don't re-attempt this assignment for a while
		// As current city chaos gets progressively bad, assign more and more sleeves to Diplomacy to help get it under control
		if (bladeburnerCityChaos > (10 - i) * 10) // Later sleeves are first to get assigned, sleeve 0 is last at 100 chaos.
			[action, contractName] = ["Diplomacy"]; // Fall-back to something long-term useful
		// If a prior attempt to assign a sleeve a default task failed, use a fallback
		else if (Date.now() - bladeburnerTaskFailed[i] < 5 * 60 * 1000) // 5 minutes seems reasonable for now
			[action, contractName] = ["Infiltrate synthoids"]; // Fall-back to something long-term useful
		let contractEvaluation = contractName || "";
		return [`Bladeburner ${action} ${contractName || ''}`.trimEnd(),
        /*   */ `ns.sleeve.setToBladeburnerAction(${i}, '${action}', '${contractEvaluation}')`,
        /*   */ `doing ${action}${contractName ? ` - ${contractName}` : ''} in Bladeburner.`];
	}
	// Finally, do crime for Karma. Homicide has the rate gain, if we can manage a decent success rate.
	//ns.print(`Figuring a crime to do`);
	var crimeChance = await calculateCrimeChance(ns, sleeve, "Homicide");
	var homicideThreshold = argsSchema['homicide-chance-threshold'];
	//ns.print(`Homicide Chance: ${crimeChance} Threshold ${homicideThreshold}`)
	var crime = crimeChance >= homicideThreshold ? 'Homicide' : 'Mug';
	return [`commit ${crime} `, `ns.sleeve.setToCommitCrime( ${i}, '${crime}' )`,
    /*   */ `committing ${crime} with chance ${((await calculateCrimeChance(ns, sleeve, crime)) * 100).toFixed(2)}% ` +
    /*   */ (argsSchema.crime || crime == "Homicide" ? '' : // If auto-criming, user may be curious how close we are to switching to homicide 
    /*   */     ` (Note: Homicide chance would be ${((await calculateCrimeChance(ns, sleeve, "Homicide")) * 100).toFixed(2)}% `)];
}

/** Sets a sleeve to its designated task, with some extra error handling logic for working for factions. 
 * @param {NS} ns 
 * @param {Player} playerInfo */
async function setSleeveTask(ns, playerInfo, i, designatedTask, command) {
	let strAction = `Set sleeve ${i} to ${designatedTask} (${command})`;
	ns.print(strAction);
	try { // Assigning a task can throw an error rather than simply returning false. We must suppress this
		if (eval(command)) {
			task[i] = designatedTask;
			ns.print(`SUCCESS: ${strAction} `);
			return true;
		}
	} catch (err) {
		ns.print(`WARNING: sleeve.js Caught (and suppressed) an unexpected error in the main loop:\n` +
			(err?.stack || '') + (typeof err === 'string' ? err : err.message || JSON.stringify(err)));
	}
	// If assigning the task failed...
	lastReassignTime[i] = 0;
	// If working for a faction, it's possible he current work isn't supported, so try the next one.
	if (designatedTask.startsWith('work for faction')) {
		const nextWorkIndex = (workByFaction[playerInfo.currentWorkFactionName] || 0) + 1;
		if (nextWorkIndex >= works.length) {
			ns.print(`WARN: Failed to ${strAction}. None of the ${works.length} work types appear to be supported. Will loop back and try again.`);
			nextWorkIndex = 0;
		} else
			ns.print(`INFO: Failed to ${strAction} - work type may not be supported. Trying the next work type (${works[nextWorkIndex]})`);
		workByFaction[playerInfo.currentWorkFactionName] = nextWorkIndex;
	} else if (designatedTask.startsWith('Bladeburner')) { // Bladeburner action may be out of operations
		bladeburnerTaskFailed[i] = Date.now(); // There will be a cooldown before this task is assigned again.
	} else
		ns.print(`ERROR: Failed to ${strAction} `);
	return false;
}

let promptedForTrainingBudget = false;
/** @param {NS} ns 
 * For when we are at risk of going into debt while training with sleeves.
 * Contains some fancy logic to spawn an external script that will prompt the user and wait for an answer. */
async function promptForTrainingBudget(ns) {
	//if (promptedForTrainingBudget) return;
	// promptedForTrainingBudget = true;
	// if (argsSchema['training-reserve'] === null && !argsSchema['disable-training'])
	// 	await runCommand(ns, `let ans = await ns.prompt("Do you want to let sleeves put you in debt while they train?"); \n` +
	// 		`await ns.write("${trainingReserveFile}", ans ? '-1E100' : '0', "w")`, '/Temp/sleeves-training-reserve-prompt.js');
}

/** @param {NS} ns 
 * Calculate the chance a sleeve has of committing homicide successfully. */
async function calculateCrimeChance(ns, sleeve, crimeName) {
	// If not in the cache, retrieve this crime's stats
	const crimeStats = cachedCrimeStats[crimeName] ?? (cachedCrimeStats[crimeName] = (4 in ownedSourceFiles ?
		ns.singularity.getCrimeStats(crimeName) :
		// Hack: To support players without SF4, hard-code values as of the current release
		crimeName == "homicide" ? { difficulty: 1, strength_success_weight: 2, defense_success_weight: 2, dexterity_success_weight: 0.5, agility_success_weight: 0.5 } :
			crimeName == "mug" ? { difficulty: 0.2, strength_success_weight: 1.5, defense_success_weight: 0.5, dexterity_success_weight: 1.5, agility_success_weight: 0.5, } :
				undefined));
	//ns.print(`Crime stats: ${crimeName} ${crimeStats.difficulty} ${sleeve.hacking}`)
	let chance =
		(crimeStats.hacking_success_weight || 0) * sleeve.hacking +
		(crimeStats.strength_success_weight || 0) * sleeve.strength +
		(crimeStats.defense_success_weight || 0) * sleeve.defense +
		(crimeStats.dexterity_success_weight || 0) * sleeve.dexterity +
		(crimeStats.agility_success_weight || 0) * sleeve.agility +
		(crimeStats.charisma_success_weight || 0) * sleeve.charisma;
	//ns.print(`Crime chance: ${crimeName} ${chance}`)
	chance /= 975;
	chance /= crimeStats.difficulty;
	//ns.print(`Crime chance: ${crimeName} ${chance}`)
	return Math.min(chance, 1);
}

/**
 * Return a formatted representation of the monetary amount using scale symbols (e.g. $6.50M)
 * @param {number} num - The number to format
 * @param {number=} maxSignificantFigures - (default: 6) The maximum significant figures you wish to see (e.g. 123, 12.3 and 1.23 all have 3 significant figures)
 * @param {number=} maxDecimalPlaces - (default: 3) The maximum decimal places you wish to see, regardless of significant figures. (e.g. 12.3, 1.2, 0.1 all have 1 decimal)
 **/
export function formatMoney(num, maxSignificantFigures = 6, maxDecimalPlaces = 3) {
    let numberShort = formatNumberShort(num, maxSignificantFigures, maxDecimalPlaces);
    return num >= 0 ? "$" + numberShort : numberShort.replace("-", "-$");
}

const symbols = ["", "k", "m", "b", "t", "q", "Q", "s", "S", "o", "n", "e33", "e36", "e39"];

/**
 * Return a formatted representation of the monetary amount using scale sympols (e.g. 6.50M) 
 * @param {number} num - The number to format
 * @param {number=} maxSignificantFigures - (default: 6) The maximum significant figures you wish to see (e.g. 123, 12.3 and 1.23 all have 3 significant figures)
 * @param {number=} maxDecimalPlaces - (default: 3) The maximum decimal places you wish to see, regardless of significant figures. (e.g. 12.3, 1.2, 0.1 all have 1 decimal)
 **/
export function formatNumberShort(num, maxSignificantFigures = 6, maxDecimalPlaces = 3) {
    if (Math.abs(num) > 10 ** (3 * symbols.length)) // If we've exceeded our max symbol, switch to exponential notation
        return num.toExponential(Math.min(maxDecimalPlaces, maxSignificantFigures - 1));
    for (var i = 0, sign = Math.sign(num), num = Math.abs(num); num >= 1000 && i < symbols.length; i++) num /= 1000;
    // TODO: A number like 9.999 once rounded to show 3 sig figs, will become 10.00, which is now 4 sig figs.
    return ((sign < 0) ? "-" : "") + num.toFixed(Math.max(0, Math.min(maxDecimalPlaces, maxSignificantFigures - Math.floor(1 + Math.log10(num))))) + symbols[i];
}

/** Format a duration (in milliseconds) as e.g. '1h 21m 6s' for big durations or e.g '12.5s' / '23ms' for small durations */
export function formatDuration(duration) {
    if (duration < 1000) return `${duration.toFixed(0)}ms`
    if (!isFinite(duration)) return 'forever (Infinity)'
    const portions = [];
    const msInHour = 1000 * 60 * 60;
    const hours = Math.trunc(duration / msInHour);
    if (hours > 0) {
        portions.push(hours + 'h');
        duration -= (hours * msInHour);
    }
    const msInMinute = 1000 * 60;
    const minutes = Math.trunc(duration / msInMinute);
    if (minutes > 0) {
        portions.push(minutes + 'm');
        duration -= (minutes * msInMinute);
    }
    let seconds = (duration / 1000.0)
    // Include millisecond precision if we're on the order of seconds
    seconds = (hours == 0 && minutes == 0) ? seconds.toPrecision(3) : seconds.toFixed(0);
    if (seconds > 0) {
        portions.push(seconds + 's');
        duration -= (minutes * 1000);
    }
    return portions.join(' ');
}