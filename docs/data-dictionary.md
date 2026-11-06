# 資料分頁與欄位

欄名是 Apps Script 與 n8n 之間的介面，請保持順序與拼字。此設定程式建立六個資料分頁；不會建立額外 Dashboard。

## Clients

| 欄 | 欄名 |
| --- | --- |
| A | `client_id` |
| B | `client_label` |
| C | `course_start` |
| D | `course_end` |
| E | `active` |
| F | `goal_text` |
| G | `goal_type` |
| H | `goal_rule` |
| I | `daily_expected_meals` |
| J | `daily_target_goal_meals` |
| K | `notes` |
| L | `created_at` |

## Meal_Intake

| 欄 | 欄名 |
| --- | --- |
| A | `submission_id` |
| B | `submitted_at` |
| C | `client_id` |
| D | `meal_date` |
| E | `meal_type` |
| F | `meal_text` |
| G | `photo_drive_url` |
| H | `ate_all` |
| I | `portion_notes` |
| J | `source` |

## Meals

| 欄 | 欄名 |
| --- | --- |
| A | `submission_id` |
| B | `client_id` |
| C | `meal_date` |
| D | `meal_type` |
| E | `meal_text` |
| F | `photo_drive_url` |
| G | `ate_all` |
| H | `portion_notes` |
| I | `client_goal` |
| J | `observed_foods` |
| K | `goal_alignment` |
| L | `ai_coach_assessment` |
| M | `missing_info` |
| N | `ai_client_draft` |
| O | `coach_approved_text` |
| P | `coach_goal_met` |
| Q | `review_status` |
| R | `manually_replied_at` |
| S | `processing_status` |
| T | `issue_flags` |
| U | `created_at` |

## Daily_Summaries

| 欄 | 欄名 |
| --- | --- |
| A | `summary_id` |
| B | `client_id` |
| C | `report_date` |
| D | `course_week` |
| E | `goal_text` |
| F | `expected_meals` |
| G | `recorded_meals` |
| H | `coverage_pct` |
| I | `daily_target_goal_meals` |
| J | `verified_goal_yes` |
| K | `verified_goal_no` |
| L | `goal_achievement_pct` |
| M | `metric_note` |
| N | `coach_summary` |
| O | `ai_client_draft` |
| P | `approved_text` |
| Q | `review_status` |
| R | `manually_replied_at` |
| S | `created_at` |

## Weekly_Summaries

| 欄 | 欄名 |
| --- | --- |
| A | `summary_id` |
| B | `client_id` |
| C | `week_no` |
| D | `week_start` |
| E | `week_end` |
| F | `goal_text` |
| G | `expected_meals` |
| H | `recorded_meals` |
| I | `coverage_pct` |
| J | `goal_target_total` |
| K | `verified_goal_yes` |
| L | `verified_goal_no` |
| M | `goal_achievement_pct` |
| N | `metric_note` |
| O | `coach_summary` |
| P | `ai_client_draft` |
| Q | `approved_text` |
| R | `review_status` |
| S | `manually_replied_at` |
| T | `created_at` |

## Reminders

| 欄 | 欄名 |
| --- | --- |
| A | `reminder_id` |
| B | `client_id` |
| C | `reminder_date` |
| D | `goal_text` |
| E | `reason` |
| F | `ai_draft` |
| G | `approved_text` |
| H | `review_status` |
| I | `manually_sent_at` |
| J | `created_at` |

## 識別碼與寫入規則

- Clients：client_id；表單遇到相同 ID 會跳過，不更新既有目標。
- Meal_Intake／Meals：submission_id；表單產生 FORM-分頁ID-列號。
- Daily_Summaries：DAY|client_id|YYYY-MM-DD。
- Weekly_Summaries：WEEK|client_id|週數。
- Reminders：NOLOG|client_id|YYYY-MM-DD。
- 日期統一 YYYY-MM-DD；追蹤時間以 Asia/Taipei 為準。
- review_status：待教練審核／退回修改／已核准／已手動回覆。
- coach_goal_met：是／否／待確認。
- 課程 active：是 才處理摘要與提醒。
- meal_type：早餐／午餐／晚餐／點心／其他。
- ate_all：已吃完／吃了一部分／未確認。
- approved_text、coach_approved_text 與手動回覆時間由教練維護。
- 不存在自動發送或讀取外部客戶平台的欄位。
