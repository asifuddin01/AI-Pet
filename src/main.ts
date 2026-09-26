import "./styles/pet.css";

import { PetController } from "./pet/PetController";
import { log } from "./services/native";

// The pet is a character, not a web page: no browser context menu (text fields keep theirs).
document.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement | null;
  if (!t?.closest("textarea, input")) e.preventDefault();
});

const root = document.getElementById("app");
if (root) {
  PetController.create(root).catch((err: unknown) => {
    log("error", `Pet failed to start: ${err instanceof Error ? err.message : String(err)}`);
  });
}
