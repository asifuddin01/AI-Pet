import "./styles/settings.css";

import { SettingsPanel } from "./components/SettingsPanel";
import { log } from "./services/native";
import { SettingsService } from "./services/SettingsService";

const root = document.getElementById("settings");
if (root) {
  SettingsService.load()
    .then((settings) => new SettingsPanel(root, settings).mount())
    .catch((err: unknown) => {
      log("error", `Settings failed to load: ${err instanceof Error ? err.message : String(err)}`);
      root.textContent = "Settings couldn't load. Please restart AI Pet.";
    });
}
