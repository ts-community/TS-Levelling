const { test } = require("node:test")
const assert = require("node:assert/strict")

const { planUserPeriodReset } = require("../classes/RecordTracker.js")

const TODAY = "2026-10-01"
const MONTH = "2026-10"

test("usuario al día no se toca", () => {
    const user = {
        monthlyMessages: 5, monthlyXP: 100, monthlyPeriod: MONTH,
        dailyMessages: 2, dailyXP: 50, dailyPeriod: TODAY,
    }
    assert.equal(planUserPeriodReset("u1", user, TODAY, MONTH), null)
})

test("usuario sin marcador se pone a 0 y se sella", () => {
    const plan = planUserPeriodReset(
        "u1",
        { monthlyMessages: 6000, monthlyXP: 9000, dailyMessages: 50, dailyXP: 100 },
        TODAY, MONTH
    )
    assert.ok(plan)
    assert.equal(plan.monthly, true)
    assert.equal(plan.daily, true)
    assert.deepEqual(plan.update.$set, {
        "users.u1.monthlyMessages": 0,
        "users.u1.monthlyXP": 0,
        "users.u1.monthlyPeriod": MONTH,
        "users.u1.dailyMessages": 0,
        "users.u1.dailyXP": 0,
        "users.u1.dailyPeriod": TODAY,
    })
    assert.equal(plan.zeroedMonthlyMessages, 6000)
    assert.equal(plan.zeroedMonthlyXP, 9000)
    assert.equal(plan.zeroedDailyMessages, 50)
})

test("usuario con mensual al día pero diario viejo solo sanea diario", () => {
    const plan = planUserPeriodReset(
        "u1",
        { monthlyMessages: 5, monthlyXP: 100, monthlyPeriod: MONTH, dailyMessages: 7, dailyPeriod: "2026-09-30" },
        TODAY, MONTH
    )
    assert.ok(plan)
    assert.equal(plan.monthly, false)
    assert.equal(plan.daily, true)
    assert.deepEqual(plan.update.$set, {
        "users.u1.dailyMessages": 0,
        "users.u1.dailyXP": 0,
        "users.u1.dailyPeriod": TODAY,
    })
    assert.equal(plan.zeroedMonthlyMessages, 0)
})

test("usuario nuevo sin contadores solo recibe el sello", () => {
    const plan = planUserPeriodReset("u1", {}, TODAY, MONTH)
    assert.ok(plan)
    assert.equal(plan.zeroedMonthlyMessages, 0)
    assert.equal(plan.update.$set["users.u1.monthlyPeriod"], MONTH)
    assert.equal(plan.update.$set["users.u1.dailyPeriod"], TODAY)
})
