<script setup>
import { ref } from "vue";

import { FButton } from "@fkui/vue";

const clicks = ref(0);
</script>

<template>
    <main>
        <h1>Vite sandbox</h1>
        <p>Button clicks: {{ clicks }}</p>
        <FButton variant="primary" size="medium" @click="clicks++"> Click here </FButton>
    </main>
</template>
