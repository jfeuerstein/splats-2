// Entry. ?spike=1 runs the M0 render spike; otherwise the game.
import { registerSW } from "./sw-register";
registerSW();
const q = new URLSearchParams(location.search);
if (q.has("spike")) void import("./spike");
else void import("./game/app");
