Use this optional service to connect your bot to a Minecraft server version newer
than the bundled 26.3 client, or as a fallback when a server rejects the native
client.

Minecraft Java 26.3 is supported natively; you do not need ViaProxy for a 26.3
server. ViaProxy 3.4.13 and newer can translate between the bot and a newer
server. For example, to connect to a 26.4 server with the bundled 26.3 client:

1. Start ViaProxy against the newer server, for example with the standalone jar:

   ```bash
   java -jar ViaProxy-3.4.14.jar cli --target-address your.server:25565 --target-version 26.4
   ```

2. Point `settings.js` at the proxy (port 25568 by default) and use `26.3` as
   the bundled client version:

   ```javascript
   "host": "localhost",
   "port": 25568,
   "minecraft_version": "26.3",
   ```

For online-mode servers, add the bot's Microsoft account in ViaProxy's account
manager first; ViaProxy performs the login against the real server.

Run:

```bash
docker-compose --profile viaproxy up
```

After first start it will create config file `services/viaproxy/viaproxy.yml`.

Edit this file and set the desired target `target-address` (and `target-version: 26.4`
when translating a newer server), then point your `settings.js` `host`, `port` and
`minecraft_version` at the viaproxy endpoint:

```javascript
    "host": "host.docker.internal",
    "port": 25568,
    "minecraft_version": "26.3",
```

This easily works with "offline" servers. 

Connecting to "online" servers via viaproxy involves more effort:\
First start the ViaProxy container, then open another terminal in the mindcraft directory.\
Run `docker attach mindcraft-viaproxy-1` in the new terminal to attach to the container.\
After attaching, you can use the `account` command to manage user accounts:
 - `account list` List all accounts in the list
 - `account add microsoft` Add a microsoft account (run the command and follow the instructions)
 - `account select <id>` Select the account to be used (run `account list` to see the ids)
 - `account remove <id>` Remove an account (run `account list` to see the ids)
 - `account deselect` Deselect the current account (go back to offline mode)

> [!WARNING]
> If you login with a microsoft account, the access token is stored in the `saves.json` file.\
> Never share this file with anyone! This would allow them to join servers in your name!

When you're done setting up your account (don't forget to select it), use `CTRL-P` then `CTRL-Q` to detach from the container.

If you want to persist these changes, you can configure them in the `services/viaproxy/viaproxy.yml`.
1. Change `auth-method` to `account`
2. Change `minecraft-account-index` to the id of your account

