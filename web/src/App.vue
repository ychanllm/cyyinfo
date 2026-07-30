<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import NavBar from './components/NavBar.vue';

const route = useRoute();
const isAdmin = computed(() => route.path.startsWith('/admin'));
</script>

<template>
  <router-view v-if="isAdmin" />
  <template v-else>
    <NavBar />
    <main class="page">
      <router-view />
    </main>
    <!-- MiniPlayer (Task 15) -->
  </template>
</template>

<style>
.page {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 20px 64px;
}
</style>
