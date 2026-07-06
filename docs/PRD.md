# DGC Global Community App — PRD

> Product source of truth. Pasted from the product owner. Keep in sync when scope changes.
> Implementation-status notes live in `CLAUDE.md` and code comments, not here.

## 1. User Registration & Onboarding
Sign up via: Phone Number, Email Address, Google Login, Apple Login.
Collect: Full Name, Phone Number, Email, Gender, Date of Birth, Branch, Occupation (optional), Profile Picture.

## 2. Branch Assignment System
When a user selects a branch during registration (e.g. DGC Abuja, Lagos, Ibadan, Port Harcourt), the system auto-joins them to:
- Branch Community (e.g. "DGC Abuja Community")
- Global Announcement Channel ("DGC Global Announcement")

## 3. User Roles & Permissions
- **Super Admin** — create/delete branches, create clusters, **create announcements**, assign admins, assign moderators, create audio rooms, view analytics. (e.g. Pastor Lawrence, Global Admin Team)
- **Branch Admin** — manage branch community, approve posts, remove members, **create branch announcements**, start audio rooms, appoint moderators.
- **Cluster Moderator** — manage cluster discussions, remove inappropriate content, approve posts if moderation enabled.
- **Member** — send messages, join clusters, attend audio rooms, react to messages, share testimonies, update profile.

## 4. Global Announcement Channel
Purpose: official communication from DGC leadership.
Permissions — only **Super Admins** and **Authorized Announcement Admins** can post.
Members can: Read, React, Save messages, Share internally.
Members cannot: Send messages, Reply directly.

Global Announcement Admin Management (Super Admin Dashboard): a managed list of Announcement Admins (e.g. Pastor Lawrence, Media Director, National Coordinator) with Add / Remove. Only Super Admins can assign or remove announcement admins.

## 5. Branch Community
Every branch has its own community space (e.g. "DGC Abuja Community") containing sections:
General Chat, Prayer Requests, Testimonies, Service Updates, Volunteer Opportunities (Media / Protocol / Ushering / Choir).

## 6. Clusters System
Interest-based communities; users can join multiple. Default clusters: Singles, Teenagers, Young Adults, Relationship Advice, Business Advice, Tech Community, Prayer Warriors, Worship Team, Media Team, Missions & Evangelism (plus other suggested clusters).
Each cluster has: Chat Room, Notice Board, Events, Files & Resources, Audio Rooms.

## 7. Community Chat Features
WhatsApp-style messaging: Text, Voice Notes, Images, Videos, Documents, GIFs, Emojis.
Interactions: Reply, Mention, Forward, Reactions, Pin Messages, Search Messages.
Message Status: Sent, Delivered, Read.

## 8. Live Audio Rooms (Clubhouse Feature)
Create/join live audio discussions (e.g. Morning Prayer, Leadership Meeting, Singles Hangout, Bible Study).
Roles: Host (speak, invite speakers, end room), Moderator (mute, promote, remove), Listener (listen, raise hand, request to speak).

## 9. Events Module
Each branch can create events (Sunday Service, Prayer Charge, Retreat, Crusade, Training Program).
Features: RSVP, Calendar Integration, Reminder Notifications, Check-In QR Code.

## 10. Sermons & Media Library
Central repository: Sermons (video/audio/notes), Worship (songs/chants/instrumentals), Documents (manuals/discipleship materials/study guides).

## 11. Growth Journey & Leadership Pipeline
Track every member's spiritual growth, service journey, leadership development, and eligibility for ministry roles. Every member has a visible growth path + progress tracker.

Stages:
1. **First Timer** — create account, join a branch, complete New Member Form, attend first service, watch Welcome Video. Unlocks Branch Community + New Member Resources.
2. **New Member** — join at least one cluster. Unlocks Foundations School Registration.
3. **Foundations School Graduate** — complete Foundations School, pass assessment, upload certificate. Unlocks Worker Application + Service Unit Enrollment.
4. **Worker** — Foundations cert verified, join a Service Unit, attend regularly, serve minimum duration, join a Prayer Chain. Units: Media, Choir, Protocol, Ushering, Technical Team, Prayer Department, Children's Church.
5. **Emerging Leader** — complete SOM, upload SOM cert, consistent service record, good-standing recommendation. Unlocks Cell Leadership Track.
6. **Cell Leader** — lead a cell group, evangelize/invite, mentor members, maintain attendance, submit monthly reports. Metrics: People Mentored, First Timers Followed Up, Active Cell Members, Leadership Score. Unlocks Advanced SOM.
7. **Advanced SOM Graduate** — complete Advanced SOM, pass assessments, upload cert (verification required). Unlocks Ministry Leadership Path.
8. **Ministry Leader** — lead a Department / Cluster / Cell Network, train workers, demonstrate consistency (e.g. Media Head, Choir Lead, Prayer Coordinator, Branch Coordinator).
9. **Pastorate Candidate** — leadership recommendation, complete required training, ministry track record, leadership review, spiritual oversight approval.
10. **Pastorate** — granted only by authorized leadership. Special badge PASTORATE. Permissions: Leadership Channels, Pastorate Discussions, Ministry Reports, Leadership Meetings.

Growth Dashboard: "My Journey" with completed/pending stages, overall progress %, and a "Next Action".
Badges: Foundations Graduate, Prayer Chain Member, SOM Graduate, Advanced SOM Graduate, Mentor, Evangelist, Cell Leader, Ministry Leader, Pastorate.

## 11b. Prayer & Testimony Module
Prayer Wall — submit prayer requests, request anonymity, receive prayer support.
Testimony Wall — post testimonies, upload images/videos, react and comment.

## 12. Notifications System
Push notifications for: Announcements, New messages, Event reminders, Audio room invitations, Prayer responses, Cluster updates.

## 13. Admin Dashboard
- User Management: view members, suspend members, assign roles, move members between branches.
- Community Management: create clusters, archive clusters, manage reports.
- Analytics: Total Members, Active Members, Branch Growth, Cluster Participation, Event Attendance, Audio Room Attendance, Leadership Pipeline breakdown.
- Verification Queue: verify Foundations School / SOM / Advanced SOM / Leadership Training certificates.

## 14. Suggested Navigation Structure
Bottom nav:
- **Home** — Announcements, Upcoming Events, Recommended Clusters
- **Chats** — Branch Chats, Cluster Chats, Direct Messages
- **Audio** — Live Rooms, Upcoming Rooms
- **Resources** — Sermons, Manuals, Downloads
- **Profile** — Settings, My Clusters, Notifications

## Database Architecture (as sketched in the PRD)
```
Users        → Branch, Role, Clusters[], Certificates, GrowthStage, ServiceUnit,
               PrayerChain, MentorshipCount, EvangelismCount, LeadershipScore, Profile
Branches     → Members[], Admins[], Events[], Channels[]
Channels     → Global Announcement, Branch Chats, Cluster Chats, Direct Messages
Audio Rooms  → Host, Moderators[], Speakers[], Listeners[]
Events       → Branch, RSVP Members[], Attendance
Resources    → Sermons, Manuals, Media Files
Certificates → Foundations School, SOM, Advanced SOM, Leadership Training, Verification Status
GrowthJourney→ Current Stage, Completed Stages, Pending Requirements, Progress Percentage
```
