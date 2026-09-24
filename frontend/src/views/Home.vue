<template>
  <div class="home-page">
    <div class="home-container">
      <div class="home-header">
        <h1>My Boards</h1>
        <el-button type="primary" :icon="Plus" @click="showCreateDialog = true">
          New Board
        </el-button>
      </div>

      <StateView
        :status="boardStore.listView.status"
        :error="boardStore.listView.error"
        loading-text="Loading boards..."
        error-title="Failed to load boards"
        empty-text="No boards yet. Create your first board!"
        @retry="boardStore.fetchBoards()"
      >
        <template #empty-extra>
          <el-button type="primary" @click="showCreateDialog = true">Create Board</el-button>
        </template>

        <div v-if="boardStore.listView.status === 'ready'" class="boards-grid">
          <BoardCard
            v-for="board in boardStore.listView.boards"
            :key="board.id"
            :board="board"
            @open="openBoard"
            @delete="confirmDeleteBoard"
          />
        </div>
      </StateView>
    </div>

    <!-- Create Board Dialog -->
    <el-dialog v-model="showCreateDialog" title="Create New Board" width="460px" :close-on-click-modal="false">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-position="top">
        <el-form-item label="Board Name" prop="name">
          <el-input v-model="createForm.name" placeholder="Enter board name" maxlength="50" show-word-limit />
        </el-form-item>
        <el-form-item label="Description (optional)" prop="description">
          <el-input v-model="createForm.description" type="textarea" :rows="3" placeholder="Enter board description" maxlength="200" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">Cancel</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreateBoard">Create</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { useBoardStore } from '../stores/board.js'
import BoardCard from '../components/BoardCard.vue'
import StateView from '../components/StateView.vue'

const router = useRouter()
const boardStore = useBoardStore()

const showCreateDialog = ref(false)
const creating = ref(false)
const createFormRef = ref(null)

const createForm = ref({ name: '', description: '' })
const createRules = {
  name: [{ required: true, message: 'Board name is required', trigger: 'blur' }]
}

onMounted(() => {
  // Store keeps the listView status; ignore the rejection here since the shared
  // state view renders the error and retry button.
  boardStore.fetchBoards().catch(() => {})
})

function openBoard(board) {
  router.push(`/board/${board.id}`)
}

async function handleCreateBoard() {
  if (!createFormRef.value) return
  const valid = await createFormRef.value.validate().catch(() => false)
  if (!valid) return

  creating.value = true
  try {
    const board = await boardStore.createBoard(createForm.value.name, createForm.value.description)
    showCreateDialog.value = false
    createForm.value = { name: '', description: '' }
    ElMessage.success('Board created!')
    router.push(`/board/${board.id}`)
  } catch (err) {
    ElMessage.error(err.response?.data?.error || 'Failed to create board')
  } finally {
    creating.value = false
  }
}

async function confirmDeleteBoard(board) {
  try {
    await ElMessageBox.confirm(
      `Are you sure you want to delete "${board.name}"? All columns and cards will be permanently removed.`,
      'Delete Board',
      { type: 'warning', confirmButtonText: 'Delete', cancelButtonText: 'Cancel' }
    )
    await boardStore.deleteBoard(board.id)
    ElMessage.success('Board deleted')
  } catch (err) {
    if (err !== 'cancel') {
      ElMessage.error('Failed to delete board')
    }
  }
}
</script>

<style scoped>
.home-page {
  padding: 30px;
}

.home-container {
  max-width: 1200px;
  margin: 0 auto;
}

.home-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
}

.home-header h1 {
  font-size: 28px;
  color: #303133;
}

.boards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
}
</style>
