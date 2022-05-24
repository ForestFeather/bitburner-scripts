# bitburner-scripts

My currently-utilized Bitburner scripts.

# Launching on system

To get it going, try this:

```javascript
export async function main(ns) {
  if (ns.getHostname() !== "home") {
    throw new Exception("Run the script from home");
  }

  await ns.wget(
    `https://dragons-burrow.com/git/ridayah/bitburner-scripts/raw/branch/master/initHacking.js?ts=${new Date().getTime()}`,
    "initHacking.js"
  );
  ns.spawn("initHacking.js", 1);
}
```

Then go `run start.ns`