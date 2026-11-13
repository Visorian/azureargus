import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

const LOGS_URL_PATTERN = /\/logs/

export async function expectActiveResultVisible(grid: Locator) {
  await expect
    .poll(
      async () =>
        await grid.evaluate((element) => {
          const id = element.getAttribute('aria-activedescendant')
          const rows = [...document.querySelectorAll<HTMLElement>('[data-result-index]')].filter(
            (row) => row.id === id,
          )
          const row = rows[0]?.getBoundingClientRect()
          const scroller = element.querySelector('.vue-recycle-scroller')?.getBoundingClientRect()
          const header = element
            .querySelector('[role="columnheader"]')
            ?.closest('[role="row"]')
            ?.getBoundingClientRect()
          return {
            unique: rows.length === 1,
            visible: Boolean(
              row &&
              scroller &&
              row.top >= Math.max(scroller.top, header?.bottom ?? scroller.top) - 1 &&
              row.bottom <= scroller.bottom + 1,
            ),
          }
        }),
    )
    .toEqual({ unique: true, visible: true })
}

export async function enterAnonymousMode(page: Page) {
  await page.goto('/logs')
  await expect(page).toHaveURL(LOGS_URL_PATTERN)
  await expect(page.getByRole('main')).toBeVisible()
}

export async function openSettings(page: Page) {
  const settingsButton = page.locator('#logs-settings-toggle')
  const settingsDrawer = page.getByRole('dialog', { name: 'Settings', exact: true })
  if ((await settingsButton.getAttribute('aria-expanded')) !== 'true') {
    await settingsButton.click()
  }
  await expect(settingsButton).toHaveAttribute('aria-expanded', 'true')
  await expect(settingsDrawer).toBeVisible()
  return settingsDrawer
}

export async function expectResultsScrollAndNavigate(
  page: Page,
  grid: Locator,
  width: number,
): Promise<void> {
  await page.setViewportSize({ width, height: 667 })
  await grid.focus()
  await page.keyboard.press('Home')
  const scroller = grid.locator('.vue-recycle-scroller')
  await scroller.hover()
  await expectWheelStep(page, grid, 37)
  await expectWheelStep(page, grid, 37)
  await expectWheelStep(page, grid, 37)
  await expectWheelStep(page, grid, 37)
  await expectWheelStep(page, grid, 1000)
  await page.keyboard.press('End')
  await expectActiveResultVisible(grid)
}

async function expectWheelStep(page: Page, grid: Locator, delta: number): Promise<void> {
  const scroller = grid.locator('.vue-recycle-scroller')
  const before = await scroller.evaluate((element) => element.scrollTop)
  await page.mouse.wheel(0, delta)
  await expect
    .poll(async () => await scroller.evaluate((element) => element.scrollTop))
    .toBe(before + delta)
  await expectActiveResultVisible(grid)
}
