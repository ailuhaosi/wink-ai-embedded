/* Phase 2 Task 2-3：host 资源占用治理（静态表）直接单测。
 * 覆盖幂等 / 冲突(BUSY) / 表满(EXHAUSTED) 三语义。 */
#include "unity.h"
#include "wink_status.h"
#include "pal_resource.h"

void setUp(void) { pal_resource_reset(); }
void tearDown(void) {}

void test_resource_claim_same_owner_idempotent(void) {
    TEST_ASSERT_EQUAL_INT(WINK_OK, pal_resource_claim(PAL_RESOURCE_GPIO_PIN, 4, "devA"));
    /* 同 (type,id) 同 owner → 幂等 OK */
    TEST_ASSERT_EQUAL_INT(WINK_OK, pal_resource_claim(PAL_RESOURCE_GPIO_PIN, 4, "devA"));
}

void test_resource_claim_conflict_returns_busy(void) {
    TEST_ASSERT_EQUAL_INT(WINK_OK, pal_resource_claim(PAL_RESOURCE_PWM_CHANNEL, 0, "servoA"));
    /* 同资源不同 owner → BUSY */
    TEST_ASSERT_EQUAL_INT(WINK_ERR_BUSY, pal_resource_claim(PAL_RESOURCE_PWM_CHANNEL, 0, "servoB"));
}

void test_resource_claim_table_full_returns_exhausted(void) {
    /* 用同 owner、不同 id 填满表（distinct 资源，均 OK） */
    for (uint32_t i = 0; i < PAL_RESOURCE_MAX_CLAIMS; i++) {
        TEST_ASSERT_EQUAL_INT(WINK_OK, pal_resource_claim(PAL_RESOURCE_GPIO_PIN, 100u + i, "filler"));
    }
    /* 第 PAL_RESOURCE_MAX_CLAIMS+1 项 → 表满 EXHAUSTED */
    TEST_ASSERT_EQUAL_INT(WINK_ERR_RESOURCE_EXHAUSTED,
                          pal_resource_claim(PAL_RESOURCE_GPIO_PIN, 999u, "overflow"));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_resource_claim_same_owner_idempotent);
    RUN_TEST(test_resource_claim_conflict_returns_busy);
    RUN_TEST(test_resource_claim_table_full_returns_exhausted);
    return UNITY_END();
}
