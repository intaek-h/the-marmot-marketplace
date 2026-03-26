# The Marmot Marketplace (Beta)

A claude code marketplace dedicated to serve The Marmot Network plugin.

Currently in beta.

## How to install

1. Add The Marmot Marketplace to Claude Code.

```bash
/plugin marketplace add intaek-h/the-marmot-marketplace
```

2. Install The Marmot Network from the marketplace.

We recommend "Install for you (user scope)" option because it doesn't create anything in your repository.
It's also easier to uninstall completely.

```bash
/plugin install the-marmot-network@the-marmot-marketplace --scope user
```

3. Restart Claude Code after installing the plugin.

```bash
claude
```

## How to uninstall

1. Start Claude Code.

```bash
claude
```

2. Run `/plugin` command in Claude Code chat.

```bash
/plugin
```

3. Go to "Installed" tab to see all installed plugins.

4. Select "the-marmot-network" and choose "Uninstall" option.

5. Go to "Marketplaces" tab to see all added marketplaces.

6. Select "the-marmot-marketplace" and choose "Remove marketplace".

7. Restart Claude Code.

```bash
exit
claude
```
