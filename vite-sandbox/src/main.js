import { createApp, h, ref } from "vue";

import { FButton } from "@fkui/vue";

import "@fkui/design/lib/fkui.css";
import "@fkui/theme-default/dist/theme-light.css";
import "./variables.css";
import "./style.css";

createApp({
    setup() {
        const clicks = ref(0);

        return () =>
            h("main", [
                h("h1", "Vite sandbox"),
                h("p", `Knappen har klickats ${clicks.value} gånger.`),
                h(
                    FButton,
                    {
                        variant: "primary",
                        size: "medium",
                        onClick: () => clicks.value++,
                    },
                    () => "Klicka här",
                ),
            ]);
    },
}).mount("#app");
