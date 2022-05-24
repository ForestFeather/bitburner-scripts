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
    `https://raw.githubusercontent.com/ForestFeather/bitburner-scripts/master/src/launchSystems.js?ts=${new Date().getTime()}`,
    "launchSystems.js"
  );
  ns.spawn("launchSystems.js", 1);
}
```

Then go `run start.js`