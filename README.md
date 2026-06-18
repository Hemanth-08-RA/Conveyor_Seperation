# Conveyor Separating Station HMI & ROS 2 Digital Twin

An interactive, premium HTML5 canvas simulation and HMI dashboard representing a industrial 3D separating station digital twin. Built with high-fidelity realistic aesthetics and physics-based solvers, it simulates a warehouse environment featuring automated conveyors, safety fencing, an Autonomous Mobile Robot (AMR) reach forklift, and a real-time **ROS 2 / RPC Dual-Brain telemetry monitor** for the **Arduino UNO Q** platform.

👉 **Live Local Simulation**: `http://localhost:8080` (Run local server)

---

## Project Demonstration Video

<video src="demo_video.mp4" width="100%" controls poster="uno_q_rpc_diagram_1781812988894.png">
  Your browser does not support the video tag.
</video>

---

## Key Features

### 1. 3D Realistic Warehouse Scenery
* **Industrial Flooring & Structure**: A realistic concrete slab floor layout with grid seams, support columns, and dark baseboard joints.
* **Safety Enclosure**: Interactive wire-mesh safety fences with blue-steel support posts and yellow warning caps protect the machinery space.
* **Pedestal Control Box**: A physical control cabinet mounted on a floor flange post, featuring start, stop, and emergency stop mushroom buttons.
* **Photo-eye Sensors**: Yellow photo-eye sensor blocks cast thin, non-obtrusive red laser beams across the belts to detect passing items.

### 2. Physical Conveyor Scaling & Kinematics
* **Proportionate Lanes**: Belt dimensions are scaled realistically (50px main belt, 24px branch belts) to match item sizes.
* **Diverter Projection Solver**: Uses a 2D line segment intersection vector solver. Items physically slide along the rotating guide horn's face in real-time, matching the angular velocity and belt speed.
* **3D Miniature Deposition**: Cardboard boxes are loaded with tiny, fully shaded 3D miniature parts (green cylinder bases and blue dome lids) rendered inside the boxes.

### 3. AMR Reach Forklift & Aisle Navigation
* **Telescoping Reach Forks**: The Autonomous Mobile Robot (AMR) features telescoping forks that slide out dynamically (0 to 38px extension) to pick and deposit boxes.
* **Collision-free Aisle Pathing**: Navigates along a dedicated corridor (`y = 81`) away from the physical racks, aligning itself, turning 90 degrees, and extending its lift mast only when docking.

### 4. Interactive ROS 2 RPC Data Flow Visualizer
* **Dual-Brain Board Schematic**: Switch to the **RPC Data Flow** view to see an animated board layout of the **Qualcomm MPU (Linux Host)** and the **STM32 MCU (Arduino Client)** on the Arduino UNO Q.
* **Real-time Bus Packets**: Watch data packets flow across the high-speed serial interconnect representing active MessagePack-RPC calls:
  * `get_encoder_ticks` (MPU polling MCU ticks)
  * `set_motor_speeds` (MPU command to motor driver)
  * `publish_sensor_state` (MCU publishing photo-eye triggers)
  * `set_servo_angle` (MPU guiding the diverter horn)
  * `dispatch_amr` (MPU triggering box warehouse storage)
* **Live Telemetry Monitor**: A scrollable black-box console displaying timestamped RPC transactions.

---

## ROS 2 Dual-Brain Integration Architecture (Arduino UNO Q)

The digital twin models the **Arduino UNO Q** platform's dual-brain layout, which is split into:
1. **Linux MPU (Host)**: Runs full ROS 2 (Jazzy/Humble), high-level navigation, and a custom RPC bridge node that connects to the local `arduino-router` daemon.
2. **STM32 MCU (Real-time Client)**: Handles low-level motor interrupts, encoder ticks, and physical pin I/O using the `Arduino_RouterBridge` and `Arduino_RPClite` libraries.

For full architectural templates, diagrams, and deployment guides, refer to:
📄 **[arduino_uno_q_ros_architecture.md](arduino_uno_q_ros_architecture.md)**

---

## File Structure

```bash
├── index.html        # HMI layout structure, player controls, and view switchers
├── style.css         # Modern slate-concrete styling and custom log panel transitions
├── sim.js            # Physics loops, AMR pathing, 3D draw helpers, and RPC visualizer
└── README.md         # Project description and documentation
```

---

## How to Run Locally

### 1. Using Python Dev Server (Recommended)
Navigate to the project directory and run a local server:
```bash
python -m http.server 8080
```
Open your browser and visit:
👉 **[http://localhost:8080](http://localhost:8080)**

### 2. Direct Launch
Simply double-click the `index.html` file to run the simulation directly in any modern web browser.
