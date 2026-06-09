import React from 'react'
import { createStore } from 'jotai/vanilla'
import { Provider } from 'jotai/react'

/**
 * Creates a fresh Jotai store + Provider wrapper for testing.
 * Each test gets its own store to avoid cross-test contamination.
 */
export function createTestProvider() {
  const store = createStore()

  function TestProvider({ children }: { children: React.ReactNode }) {
    return <Provider store={store}>{children}</Provider>
  }

  return { store, TestProvider }
}
