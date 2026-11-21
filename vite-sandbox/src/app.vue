<script setup>
import { ref } from "vue";

import { FButton } from "@fkui/vue";

const clicks = ref(0);
</script>

<template>
    <main>
        <h1>Vite sandbox</h1>
        <p>Knappen har klickats {{ clicks }} gånger.</p>
        <FButton variant="primary" size="medium" @click="clicks++"> Klicka här </FButton>
    </main>
</template>
