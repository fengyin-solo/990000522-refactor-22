import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { boardApi, columnApi, cardApi } from '../api/index.js'

// Status machine shared by every list surface in the app:
// 'idle' -> 'loading' -> 'success' | 'error'.
// Views only ever branch on this single derived vocabulary, so the
// board list page and the board workspace render the same states.

export const useBoardStore = defineStore('board', () => {
  const boards = ref([])
  const boardsStatus = ref('idle')
  const boardsError = ref(null)

  const currentBoard = ref(null)
  const boardStatus = ref('idle')
  const boardError = ref(null)
  const columns = ref([])
  const cards = ref({}) // columnId -> [cards]
  // Per-column card request status: { [columnId]: { status, error } }
  const cardStatuses = ref({})

  const boardsLoading = computed(() => boardsStatus.value === 'loading')
  const boardLoading = computed(() => boardStatus.value === 'loading')
  const boardFailed = computed(() => boardStatus.value === 'error')
  const failedColumns = computed(() =>
    columns.value.filter(col => cardStatuses.value[col.id]?.status === 'error')
  )
  const partialFailure = computed(() => failedColumns.value.length > 0)

  function errorMessage(err, fallback) {
    return err?.response?.data?.error || fallback
  }

  // ---- Board list ----
  async function fetchBoards() {
    boardsStatus.value = 'loading'
    boardsError.value = null
    try {
      const res = await boardApi.list()
      boards.value = res.data
      boardsStatus.value = 'success'
    } catch (err) {
      boardsError.value = errorMessage(err, 'Failed to load boards')
      boardsStatus.value = 'error'
      throw err
    }
  }

  // Fetch board metadata without touching any UI-visible status flag.
  // Used to resolve the board name when a board is opened by URL.
  async function ensureBoardMeta(boardId) {
    const found = boards.value.find(b => b.id === boardId)
    if (found) {
      currentBoard.value = found
      return found
    }
    const res = await boardApi.list()
    boards.value = res.data
    const board = boards.value.find(b => b.id === boardId) || { id: boardId, name: `Board ${boardId}` }
    currentBoard.value = board
    return board
  }

  async function createBoard(name, description) {
    const res = await boardApi.create(name, description)
    boards.value.unshift(res.data)
    return res.data
  }

  async function deleteBoard(id) {
    await boardApi.delete(id)
    boards.value = boards.value.filter(b => b.id !== id)
  }

  // ---- Single board workspace ----

  // Single entry point for (re)entering a board. Derives every state the
  // workspace can be in: full-screen loading, hard failure, empty board,
  // partial card failure and the fully-loaded view.
  async function loadBoard(boardId) {
    boardStatus.value = 'loading'
    boardError.value = null
    currentBoard.value = { id: boardId, name: 'Loading...' }
    columns.value = []
    cards.value = {}
    cardStatuses.value = {}

    // Metadata and columns load in parallel; a title resolves as soon as
    // either request answers so revisits never flash a wrong title.
    const metaPromise = ensureBoardMeta(boardId).catch(() => {})
    let columnData
    try {
      const res = await columnApi.list(boardId)
      columnData = res.data
    } catch (err) {
      await metaPromise
      boardError.value = errorMessage(err, 'Failed to load board')
      boardStatus.value = 'error'
      throw err
    }

    columns.value = columnData
    cards.value = {}
    cardStatuses.value = {}
    for (const col of columnData) {
      cards.value[col.id] = []
      cardStatuses.value[col.id] = { status: 'loading', error: null }
    }
    boardStatus.value = 'success'
    await metaPromise

    // Cards are fetched per column so one failing column is isolated;
    // every column always carries an explicit status (never an empty
    // array masquerading as "no cards"). Partial failures stay
    // resolved here and surface through cardStatuses instead.
    await Promise.allSettled(
      columnData.map(col => loadColumnCards(col.id, { keepPrevious: false, markLoading: false }))
    )
  }

  async function loadColumnCards(columnId, { keepPrevious = false, markLoading = true } = {}) {
    if (markLoading) {
      cardStatuses.value[columnId] = { status: 'loading', error: null }
    }
    try {
      const res = await cardApi.list(columnId)
      cards.value[columnId] = res.data
      cardStatuses.value[columnId] = { status: 'success', error: null }
      return res.data
    } catch (err) {
      if (!keepPrevious) cards.value[columnId] = []
      cardStatuses.value[columnId] = {
        status: 'error',
        error: errorMessage(err, 'Failed to load cards')
      }
      throw err
    }
  }

  // Refetch cards for every column after a mutation/move could not be
  // reconciled locally; resolves on success, rejects only if every
  // column failed so callers can show a retry surface.
  async function syncBoardCards() {
    const results = await Promise.allSettled(
      columns.value.map(col =>
        loadColumnCards(col.id, { keepPrevious: true, markLoading: false })
      )
    )
    if (results.length > 0 && results.every(r => r.status === 'rejected')) {
      throw results[0].reason
    }
  }

  async function retryFailedColumns() {
    await Promise.all(
      failedColumns.value.map(col =>
        loadColumnCards(col.id, { keepPrevious: false, markLoading: true })
      )
    )
  }

  async function addColumn(boardId, name) {
    const res = await columnApi.create(boardId, name)
    columns.value.push(res.data)
    cards.value[res.data.id] = []
    cardStatuses.value[res.data.id] = { status: 'success', error: null }
    return res.data
  }

  async function renameColumn(colId, name) {
    const res = await columnApi.update(colId, { name })
    const idx = columns.value.findIndex(c => c.id === colId)
    if (idx !== -1) columns.value[idx] = res.data
    return res.data
  }

  async function deleteColumn(colId) {
    await columnApi.delete(colId)
    columns.value = columns.value.filter(c => c.id !== colId)
    delete cards.value[colId]
    delete cardStatuses.value[colId]
  }

  // Persist a dragged column order. The drag itself is optimistic
  // (columns were already reordered by vuedraggable); on failure we
  // reload the board to reconcile instead of wiping card state.
  async function persistColumnOrder() {
    const boardId = currentBoard.value?.id
    if (!boardId) return
    try {
      for (let i = 0; i < columns.value.length; i++) {
        if (columns.value[i].position !== i) {
          await columnApi.update(columns.value[i].id, { position: i })
          columns.value[i].position = i
        }
      }
    } catch (err) {
      await loadBoard(boardId).catch(() => {})
      throw err
    }
  }

  // ---- Cards ----
  async function fetchCards(columnId) {
    return loadColumnCards(columnId, { keepPrevious: false, markLoading: true })
  }

  async function addCard(columnId, data) {
    const res = await cardApi.create(columnId, data)
    if (!cards.value[columnId]) cards.value[columnId] = []
    cards.value[columnId].push(res.data)
    cardStatuses.value[columnId] = { status: 'success', error: null }
    return res.data
  }

  async function updateCard(cardId, data) {
    const res = await cardApi.update(cardId, data)
    // Update card in the local state
    for (const colId in cards.value) {
      const idx = cards.value[colId].findIndex(c => c.id === cardId)
      if (idx !== -1) {
        cards.value[colId][idx] = res.data
        break
      }
    }
    return res.data
  }

  async function deleteCard(cardId) {
    await cardApi.delete(cardId)
    for (const colId in cards.value) {
      cards.value[colId] = cards.value[colId].filter(c => c.id !== cardId)
    }
  }

  // Move (or reorder) a card. vuedraggable has already mutated the DOM
  // optimistically, so we mirror that mutation in store state first and
  // only fall back to a server resync when the request fails.
  async function moveCard(cardId, targetColumnId, position) {
    let sourceColumnId = null
    let sourceIndex = -1
    for (const colId in cards.value) {
      const idx = cards.value[colId].findIndex(c => c.id === cardId)
      if (idx !== -1) {
        sourceColumnId = colId
        sourceIndex = idx
        break
      }
    }
    const sourceCards = sourceColumnId !== null ? cards.value[sourceColumnId] : null
    const targetCards = cards.value[targetColumnId] || (cards.value[targetColumnId] = [])
    const snapshot = sourceCards ? sourceCards.slice() : null
    const targetSnapshot = sourceColumnId !== targetColumnId ? targetCards.slice() : null

    let movedCard = null
    if (sourceCards) {
      movedCard = sourceCards.splice(sourceIndex, 1)[0]
    }
    const clamped = Math.max(0, Math.min(position, targetCards.length))
    if (movedCard) {
      movedCard.column_id = targetColumnId
      movedCard.position = clamped
      targetCards.splice(clamped, 0, movedCard)
    }

    try {
      const res = await cardApi.move(cardId, targetColumnId, clamped)
      if (movedCard) Object.assign(movedCard, res.data)
      return res.data
    } catch (err) {
      // Roll back the optimistic change, then reconcile with the server.
      if (sourceColumnId !== null && snapshot) {
        cards.value[sourceColumnId] = snapshot
      }
      if (sourceColumnId !== targetColumnId && targetSnapshot) {
        cards.value[targetColumnId] = targetSnapshot
      }
      await syncBoardCards().catch(() => {})
      throw err
    }
  }

  function clearBoard() {
    currentBoard.value = null
    boardStatus.value = 'idle'
    boardError.value = null
    columns.value = []
    cards.value = {}
    cardStatuses.value = {}
  }

  return {
    // state
    boards,
    boardsStatus,
    boardsError,
    currentBoard,
    boardStatus,
    boardError,
    columns,
    cards,
    cardStatuses,
    // derived
    boardsLoading,
    boardLoading,
    boardFailed,
    failedColumns,
    partialFailure,
    // board list
    fetchBoards, createBoard, deleteBoard,
    // workspace
    loadBoard, clearBoard,
    loadColumnCards, syncBoardCards, retryFailedColumns,
    // columns
    addColumn, renameColumn, deleteColumn, persistColumnOrder,
    // cards
    fetchCards, addCard, updateCard, deleteCard, moveCard
  }
})
