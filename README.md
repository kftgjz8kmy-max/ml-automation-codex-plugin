# ML Automation Codex Plugin

This public marketplace contains the single **ML Automation** plugin for Codex. Installing it registers both the remote Mercado Libre MCP and the local photo handler automatically.

## Install

```bash
codex plugin marketplace add kftgjz8kmy-max/ml-automation-codex-plugin --ref main && codex plugin add ml-automation@one-main
```

Restart Codex after installation. Then authenticate the remote MCP in the normal browser flow. No API key, Mercado Libre token, or separate local bridge configuration is required.

## Photos

Attach image files, attach a ZIP, or provide an explicit local folder path in the same listing request. The plugin uses a short-lived internal upload permission and never places Mercado Libre credentials on the laptop.
